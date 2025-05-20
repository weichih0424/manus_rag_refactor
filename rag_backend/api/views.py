# /home/ubuntu/manus_rag_refactor/backend_merged/api/views.py
import uuid
import os
import logging
from datetime import datetime

from rest_framework import viewsets, status, generics
from rest_framework.views import APIView # Added APIView import
from rest_framework.response import Response
from rest_framework.decorators import action, api_view
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.shortcuts import get_object_or_404
from django.conf import settings # For MEDIA_ROOT

from .models import File, Tag, ChatMessage, Settings as SettingsModel # Renamed to avoid conflict with django.conf.settings
from .serializers import (
    FileSerializer,
    FileUploadSerializer, 
    TagSerializer,
    ChatMessageSerializer,
    SettingsSerializer,
    QuerySerializer, # From user's original serializers
    FileTagsSerializer, # Added FileTagsSerializer
    StatusResponseSerializer,
    SuccessResponseSerializer,
    EmptySerializer,
    KnowledgeBaseStatusSerializer,
    VectorstoreMaintenanceResponseSerializer
)
from .rag_instance import rag_manager_singleton # Use the singleton RAGManager

logger = logging.getLogger(__name__)

# Test endpoints (can be removed or kept for utility)
@api_view(["GET"])
def ping(request):
    return Response({"message": "pong"})

@api_view(["POST"])
def echo(request):
    return Response({"you_sent": request.data})

class FileViewSet(viewsets.ModelViewSet):
    queryset = File.objects.all().order_by("-upload_time")
    serializer_class = FileSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_serializer_class(self):
        if self.action == "upload_file": # Changed action name for clarity
            return FileUploadSerializer
        return FileSerializer

    @action(detail=False, methods=["post"], name="Upload File")
    def upload_file(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded_file = serializer.validated_data["file"]

        # Basic validation (can be enhanced)
        allowed_extensions = {"pdf", "txt", "docx", "csv", "html"}
        file_extension = uploaded_file.name.split(".")[-1].lower()
        if file_extension not in allowed_extensions:
            logger.warning(f"Upload rejected: File type not allowed - {uploaded_file.name}")
            return Response({"error": "File type not allowed"}, status=status.HTTP_400_BAD_REQUEST)

        # Create File model instance, Django handles saving the file via FileField
        file_instance = File(
            original_filename=uploaded_file.name,
            file_size=uploaded_file.size,
            file_type=file_extension,
            status="processing",  # 直接設為 processing 狀態
            file=uploaded_file # This will save to MEDIA_ROOT/uploads/
        )
        file_instance.save()
        logger.info(f"File model instance created: {file_instance.original_filename} (ID: {file_instance.id}), stored at: {file_instance.file.name}")

        # Trigger background processing using RAGManager
        absolute_file_path = file_instance.file.path
        file_id_str = str(file_instance.id)

        try:
            # 在背景執行檔案處理 (這裡可以使用 Celery 或其他非同步方法)
            # 為了簡化示例，我們仍然同步處理，但在實際環境中應該改為非同步
            logger.info(f"Calling RAGManager to process file: {file_id_str} at {absolute_file_path}")
            
            # 使用 RAGManager 處理檔案，這會更新 RAG DB 和 Django DB
            import threading
            processing_thread = threading.Thread(
                target=rag_manager_singleton.process_file,
                args=(file_id_str, absolute_file_path),
                daemon=True
            )
            processing_thread.start()
            
            logger.info(f"Background processing started for file: {file_id_str}")

        except Exception as e:
            logger.exception(f"Failed to start processing for file {file_instance.id}: {e}")
            file_instance.status = "error"
            file_instance.save()
            return Response({"error": f"Failed to process file: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response_serializer = FileSerializer(file_instance, context={"request": request})
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        file_id_str = str(instance.id)
        logger.info(f"Received request to delete file model instance: {file_id_str}")
        try:
            # Call RAGManager to delete from its vectorstore and its own DB
            rag_manager_singleton.delete_file(file_id_str) # This also removes the physical file in user's code
            
            # Then delete the Django model instance. Django's FileField will also delete the file from storage by default.
            # If RAGManager already deleted the physical file, Django might log a warning but should proceed.
            self.perform_destroy(instance)
            logger.info(f"File model instance {file_id_str} and associated data deleted.")
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            logger.exception(f"Error deleting file {file_id_str}: {e}")
            return Response({"error": f"Failed to delete file: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["post"], name="Apply Tags")
    def tags(self, request):
        """將標籤應用到指定的文件"""
        serializer = FileTagsSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        file_ids = serializer.validated_data.get("file_ids", [])
        tags = serializer.validated_data.get("tags", [])
        
        if not file_ids or not tags:
            return Response({"error": "文件ID和標籤都不能為空"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # 獲取或創建Tag對象
            tag_objects = []
            for tag_name in tags:
                tag_obj, created = Tag.objects.get_or_create(name=tag_name)
                tag_objects.append(tag_obj)
            
            # 為每個文件添加標籤
            for file_id in file_ids:
                try:
                    file_obj = File.objects.get(id=file_id)
                    file_obj.tags.add(*tag_objects)
                    logger.info(f"已為文件 {file_id} 添加標籤: {tags}")
                except File.DoesNotExist:
                    logger.warning(f"找不到ID為 {file_id} 的文件記錄")
            
            return Response({"success": True, "message": f"已成功為 {len(file_ids)} 個文件添加標籤"}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception(f"應用標籤時出錯: {e}")
            return Response({"error": f"應用標籤失敗: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=["post"], name="Remove Tags")
    def remove_tags(self, request):
        """從指定的文件中移除標籤"""
        serializer = FileTagsSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        file_ids = serializer.validated_data.get("file_ids", [])
        tags = serializer.validated_data.get("tags", [])
        
        if not file_ids or not tags:
            return Response({"error": "文件ID和標籤都不能為空"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # 獲取Tag對象
            tag_objects = Tag.objects.filter(name__in=tags)
            if tag_objects.count() == 0:
                return Response({"success": True, "message": "沒有找到指定的標籤"}, status=status.HTTP_200_OK)
            
            # 從每個文件移除標籤
            for file_id in file_ids:
                try:
                    file_obj = File.objects.get(id=file_id)
                    file_obj.tags.remove(*tag_objects)
                    logger.info(f"已從文件 {file_id} 移除標籤: {tags}")
                except File.DoesNotExist:
                    logger.warning(f"找不到ID為 {file_id} 的文件記錄")
            
            return Response({"success": True, "message": f"已成功從 {len(file_ids)} 個文件移除標籤"}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception(f"移除標籤時出錯: {e}")
            return Response({"error": f"移除標籤失敗: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class QueryView(APIView):
    serializer_class = QuerySerializer
    
    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        question = serializer.validated_data["question"]
        show_sources = serializer.validated_data.get("show_sources", True)
        
        try:
            answer, related_docs = rag_manager_singleton.query(question)
            # 創建聊天消息
            chat_id = str(uuid.uuid4())
            chat_message = ChatMessage.objects.create(
                id=chat_id,
                user_message=question, 
                assistant_message=answer, 
                related_docs=related_docs,
                show_sources=show_sources
            )
            
            return Response({
                "id": str(chat_message.id),
                "user_message": question,
                "assistant_message": answer, 
                "related_docs": related_docs,
                "show_sources": show_sources
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception(f"Error processing query: {e}")
            return Response({"error": f"Failed to process query: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ChatMessageViewSet(viewsets.ModelViewSet):
    queryset = ChatMessage.objects.all().order_by("timestamp")
    serializer_class = ChatMessageSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]  # 確保包含post方法
    
    @action(detail=False, methods=["delete"], name="Clear History")
    def clear(self, request):
        """清空所有聊天歷史"""
        try:
            ChatMessage.objects.all().delete()
            return Response({"success": True}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception(f"清空聊天歷史時出錯: {e}")
            return Response({"success": False, "error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=["post"], url_path="regenerate", url_name="regenerate")
    def regenerate(self, request):
        """重新生成回答，嘗試使用不同的策略"""
        serializer = QuerySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        question = serializer.validated_data["question"]
        chat_id = serializer.validated_data.get("id")
        show_sources = serializer.validated_data.get("show_sources", True)
        
        try:
            # 使用不同策略獲取回答
            answer, related_docs = rag_manager_singleton.query(question, use_different_strategy=True)
            
            # 更新或創建對話記錄
            if chat_id:
                try:
                    chat_message = ChatMessage.objects.get(id=chat_id)
                    chat_message.assistant_message = answer
                    chat_message.related_docs = related_docs
                    chat_message.show_sources = show_sources
                    chat_message.save()
                except ChatMessage.DoesNotExist:
                    chat_id = str(uuid.uuid4())
                    chat_message = ChatMessage.objects.create(
                        id=chat_id,
                        user_message=question,
                        assistant_message=answer,
                        related_docs=related_docs,
                        show_sources=show_sources
                    )
            else:
                chat_id = str(uuid.uuid4())
                chat_message = ChatMessage.objects.create(
                    id=chat_id,
                    user_message=question,
                    assistant_message=answer,
                    related_docs=related_docs,
                    show_sources=show_sources
                )
            
            return Response({
                "id": str(chat_message.id),
                "user_message": question,
                "assistant_message": answer,
                "related_docs": related_docs,
                "show_sources": show_sources
            }, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception(f"重新生成回答時出錯: {e}")
            return Response({"error": f"重新生成回答時出錯: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# Settings View (from my previous version, assuming it's needed)
class SettingsAPIView(generics.RetrieveUpdateAPIView):
    serializer_class = SettingsSerializer

    def get_object(self):
        settings_obj, _ = SettingsModel.objects.get_or_create(pk=1) # Using the Django model
        # Ensure API key is loaded from .env if not set
        if not settings_obj.openai_api_key:
            settings_obj.openai_api_key = os.getenv("OPENAI_API_KEY")
            if settings_obj.openai_api_key: # Save only if a key was found
                 settings_obj.save()
        return settings_obj

    def perform_update(self, serializer):
        instance = serializer.save() # Saves to Django DB
        logger.info(f"Django SettingsModel updated via API: {serializer.validated_data}")
        try:
            # Update the RAGManager's internal settings
            # The user's RAGManager has update_settings and save_settings methods
            rag_manager_singleton.update_settings(serializer.validated_data)
            rag_manager_singleton.save_settings() # This saves to rag.db
            logger.info("RAGManager settings updated and saved to its DB.")
        except Exception as e:
            logger.exception(f"Error updating RAG manager after settings save: {e}")

# TagViewSet (from my previous version, if needed)
class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all().order_by("create_time")
    serializer_class = TagSerializer

# 知識庫狀態視圖
@api_view(["GET"])
def knowledge_base_status(request):
    """
    獲取知識庫的狀態信息
    """
    try:
        # 使用RAGManager獲取知識庫狀態信息
        files_info = rag_manager_singleton.get_all_files()
        total_files = len(files_info)
        processed_files = sum(1 for file in files_info if file['status'] == 'processed')
        
        # 獲取向量存儲的信息
        vector_count = rag_manager_singleton.vector_manager.get_document_count() if hasattr(rag_manager_singleton.vector_manager, 'get_document_count') else 0
        
        # 更新Django的File記錄，與RAGManager的狀態同步
        for file_info in files_info:
            file_id = file_info.get('id')
            file_status = file_info.get('status')
            chunks_count = file_info.get('chunks_count', 0)
            
            try:
                # 獲取並更新Django模型對象
                file_obj = File.objects.get(id=file_id)
                if file_obj.status != file_status or file_obj.chunks_count != chunks_count:
                    logger.info(f"更新文件狀態從 {file_obj.status} 到 {file_status}, 文件ID: {file_id}")
                    file_obj.status = file_status
                    file_obj.chunks_count = chunks_count
                    file_obj.save()
                    logger.info(f"已同步文件 {file_id} 的狀態: {file_status}, 塊數: {chunks_count}")
            except File.DoesNotExist:
                logger.warning(f"找不到ID為 {file_id} 的文件記錄")
            except Exception as e:
                logger.error(f"更新文件記錄時出錯: {e}")
        
        # 與前端模型保持一致的欄位名稱
        status_info = {
            "total_files": total_files,
            "processed_files": processed_files,
            "vector_count": vector_count,
            "files_count": processed_files,  # 只計算已處理完成的文件數
            "chunks_count": vector_count,
            "is_ready": total_files > 0 and processed_files > 0,
            "last_updated": datetime.now().isoformat()
        }
        
        serializer = KnowledgeBaseStatusSerializer(data=status_info)
        if serializer.is_valid():
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        logger.exception(f"獲取知識庫狀態時出錯: {e}")
        return Response({"error": f"獲取知識庫狀態時出錯: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# 向量庫維護視圖
@api_view(["POST"])
def vectorstore_maintenance(request):
    """
    執行向量庫維護，清理沒有 file_id 的文檔
    """
    try:
        # 執行向量庫維護
        rag_manager_singleton.vector_manager.maintenance()
        
        # 獲取當前文檔數量
        doc_count = rag_manager_singleton.vector_manager.get_document_count()
        
        response_data = {
            'success': True, 
            'message': '向量庫維護完成',
            'document_count': doc_count
        }
        
        serializer = VectorstoreMaintenanceResponseSerializer(data=response_data)
        if serializer.is_valid():
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        logger.exception(f"向量庫維護失敗: {e}")
        return Response({'error': f'向量庫維護失敗: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# 文件取消處理路由
@api_view(["POST"])
def cancel_processing(request, file_id):
    """取消文件處理"""
    try:
        file = get_object_or_404(File, id=file_id)
        if file.status in ['uploading', 'processing']:
            file.status = 'cancelled'
            file.save()
            
            # 通知RAG管理器取消文件處理
            rag_manager_singleton.cancel_file_processing(file_id)
            
            return Response({"success": True}, status=status.HTTP_200_OK)
        else:
            return Response({"error": "只能取消上傳中或處理中的文件"}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.exception(f"取消文件處理時出錯: {e}")
        return Response({"error": f"取消文件處理時出錯: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# 文件狀態輪詢路由 - 專門用於前端檢查文件處理狀態
@api_view(["GET"])
def file_status(request, file_id):
    """獲取單個文件的處理狀態，強制同步狀態"""
    try:
        # 先嘗試從RAG管理器獲取最新狀態
        rag_file_info = None
        try:
            all_files = rag_manager_singleton.get_all_files()
            for file_info in all_files:
                if file_info.get('id') == file_id:
                    rag_file_info = file_info
                    break
        except Exception as e:
            logger.error(f"從RAG管理器獲取文件信息時出錯: {e}")
        
        # 獲取Django文件記錄
        file_obj = get_object_or_404(File, id=file_id)
        
        # 如果RAG管理器有更新的狀態，則同步到Django模型
        if rag_file_info and (file_obj.status != rag_file_info.get('status') or 
                              file_obj.chunks_count != rag_file_info.get('chunks_count', 0)):
            old_status = file_obj.status
            file_obj.status = rag_file_info.get('status')
            file_obj.chunks_count = rag_file_info.get('chunks_count', 0)
            file_obj.save()
            logger.info(f"文件狀態已更新 {file_id}: 從 {old_status} 到 {file_obj.status}")
        
        # 返回文件的最新狀態
        serializer = FileSerializer(file_obj, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)
    except File.DoesNotExist:
        return Response({"error": "文件不存在"}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.exception(f"獲取文件狀態時出錯: {e}")
        return Response({"error": f"獲取文件狀態時出錯: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

