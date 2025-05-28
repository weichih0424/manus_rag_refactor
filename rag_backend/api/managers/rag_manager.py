"""
RAG Web App - RAG管理器 (優化版)
負責整體RAG系統管理
"""
import os
import django
from django.conf import settings as django_settings

# 確保 Django 已經設置
if not django_settings.configured:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'rag_backend.settings')
    django.setup()

from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
import sqlite3
import logging
import time
import uuid
import json
import re

from dotenv import load_dotenv
load_dotenv()  # 載入環境變數

from langchain_huggingface import HuggingFaceEmbeddings
from langchain.schema import Document

# 導入其他管理器
from api.managers.llm_manager import LLMManager
from api.managers.retrieval import RetrievalManager
from api.managers.file_processor import FileProcessor
from api.managers.vector_manager import VectorManager

from api.models import Setting

logger = logging.getLogger(__name__)

# 自定義日誌函數，確保輸出後立即刷新
def log_message(message):
    """輸出日誌並立即刷新緩衝區"""
    print(message, flush=True)

class RAGManager:
    """RAG管理器類，整合所有RAG組件"""
    
    def __init__(self, chroma_db_dir: str, upload_dir: str, db_path: str):
        """
        初始化RAG管理器
        
        Args:
            chroma_db_dir: ChromaDB目錄
            upload_dir: 上傳文件目錄
            db_path: SQLite數據庫路徑
        """
        self.chroma_db_dir = chroma_db_dir
        self.upload_dir = upload_dir
        self.db_path = db_path
        
        # 正常初始化流程
        self._initialize()
    
    def _get_default_settings(self) -> Dict[str, Any]:
        """獲取預設設置"""
        return {
            'embedding_model': 'BAAI/bge-large-zh',
            'llm_model': 'gpt-3.5-turbo',
            'temperature': 0.1,
            'max_tokens': 1000,
            'chunk_size': 1000,
            'chunk_overlap': 200,
            'top_k': 4,
            'use_rag_fusion': False,
            'use_reranking': False,
            'use_cot': False,
            'use_bm25': True,
            'use_contextual_embeddings': True,
            'use_hybrid': True,
            'use_intelligent_splitting': True
        }
    
    def _initialize(self):
        """執行完整初始化"""
        # 不再需要 DatabaseManager，完全使用 Django ORM
        
        # 使用 Django ORM 加載設置，如果失敗則使用預設設置
        try:
            from api.models import Setting
            django_settings_obj = Setting.load()
            self.settings = django_settings_obj.to_dict()
            print("使用 Django ORM 加載設置成功")
        except Exception as e:
            print(f"Django ORM 加載設置失敗: {str(e)}")
            print("使用預設設置")
            self.settings = self._get_default_settings()
        
        # 初始化嵌入模型
        self.embeddings = HuggingFaceEmbeddings(model_name=self.settings['embedding_model'])
        
        # 打印所有使用的參數
        print("\n" + "="*50)
        print("RAG系統參數配置：")
        print("="*50)
        print(f"[RAGManager]")
        print(f"嵌入模型 (embedding_model)：{self.settings['embedding_model']}")
        print(f"語言模型 (llm_model)：{self.settings['llm_model']}")
        print(f"溫度 (temperature)：{self.settings['temperature']}")
        print(f"最大令牌數 (max_tokens)：{self.settings['max_tokens']}")
        print(f"分塊大小 (chunk_size)：{self.settings['chunk_size']}")
        print(f"分塊重疊 (chunk_overlap)：{self.settings['chunk_overlap']}")
        print(f"檢索數量 (top_k)：{self.settings['top_k']}")
        print(f"使用RAG Fusion (use_rag_fusion)：{self.settings['use_rag_fusion']}")
        print(f"使用重排序 (use_reranking)：{self.settings['use_reranking']}")
        print(f"使用思維鏈 (use_cot)：{self.settings['use_cot']}")
        print(f"使用BM25 (use_bm25)：{self.settings['use_bm25']}")
        print(f"使用上下文嵌入 (use_contextual_embeddings)：{self.settings['use_contextual_embeddings']}")
        print(f"使用混合檢索 (use_hybrid)：{self.settings['use_hybrid']}")
        print(f"使用智能分割 (use_intelligent_splitting)：{self.settings['use_intelligent_splitting']}")
        print("="*50 + "\n")
        
        # 初始化向量管理器
        self.vector_manager = VectorManager(self.chroma_db_dir, self.embeddings)
        
        # 初始化LLM管理器
        self.llm_manager = LLMManager(self.settings, self.vector_manager)
        
        # 初始化檢索管理器
        self.retrieval_manager = RetrievalManager(self.vector_manager, self.llm_manager.llm, self.settings)
        
        # 初始化文件處理器，傳遞 db_path
        self.file_processor = FileProcessor(
            self.settings, 
            self.embeddings, 
            self.vector_manager, 
            self.llm_manager.llm, 
            self.chroma_db_dir, 
            self.db_path
        )
    
    def cancel_file_processing(self, file_id: str) -> None:
        """
        取消指定文件的處理
        
        Args:
            file_id: 文件ID
        """
        log_message(f"開始取消文件 {file_id} 的處理...")
        
        try:
            # 直接使用 Django ORM 獲取和更新文件狀態
            from django.apps import apps
            File = apps.get_model('api', 'File')
            
            try:
                file_obj = File.objects.get(id=file_id)
                
                if file_obj.status in ['uploading', 'processing']:
                    # 更新狀態為已取消
                    log_message(f"將文件 {file_id} 狀態設置為已取消...")
                    file_obj.status = 'cancelled'
                    file_obj.save()
                    
                    # 從向量存儲中移除相關文檔
                    log_message(f"從向量存儲中移除文件 {file_id} 相關文檔...")
                    # 先嘗試根據文件路徑刪除
                    if file_obj.file:
                        self.vector_manager.delete_documents_by_source(file_obj.file.path)
                    # 再嘗試根據文件ID刪除
                    self.vector_manager.delete_file(file_id)
                    log_message(f"已取消文件 {file_id} 的處理並清理相關數據")
                else:
                    log_message(f"文件 {file_id} 當前狀態為 {file_obj.status}，不需要取消")
                    
            except File.DoesNotExist:
                log_message(f"找不到文件 {file_id} 的信息")
                
        except Exception as e:
            log_message(f"取消文件處理時出錯: {str(e)}")
            import traceback
            traceback.print_exc()
    
    def _ensure_dependencies(self):
        """
        確保必要的依賴已安裝
        """
        try:
            import jieba
            from rank_bm25 import BM25Okapi
            import numpy as np
            log_message("所有必要的依賴已安裝")
            return True
        except ImportError as e:
            log_message(f"缺少必要的依賴: {str(e)}")
            log_message("正在安裝缺少的依賴...")
            
            try:
                import subprocess
                subprocess.check_call(["pip", "install", "jieba", "rank_bm25", "numpy"])
                log_message("依賴安裝成功")
                return True
            except Exception as e:
                log_message(f"安裝依賴時出錯: {str(e)}")
                return False

    def update_settings(self, new_settings: Dict[str, Any]) -> None:
        """
        更新設置
        
        Args:
            new_settings: 新設置
        """
        self.settings.update(new_settings)
        
        if 'embedding_model' in new_settings:
            self.embeddings = HuggingFaceEmbeddings(model_name=self.settings['embedding_model'])
            self.vector_manager.update_embeddings(self.embeddings)
        
        if any(key in new_settings for key in ['llm_model', 'temperature', 'max_tokens']):
            self.llm_manager.update_llm_settings(new_settings, self.vector_manager)
        
        self.retrieval_manager.Setting.update(new_settings)
        self.file_processor.update_settings(new_settings)
    
    def _format_context(self, documents: List[Document]) -> str:
        """
        格式化上下文
        
        Args:
            documents: 文檔列表
            
        Returns:
            格式化後的上下文
        """
        context_parts = []
        for i, doc in enumerate(documents):
            file_id = doc.metadata.get('file_id', '')
            
            # 嘗試從 Django 獲取文件名
            file_name = "Unknown"
            try:
                from django.apps import apps
                File = apps.get_model('api', 'File')
                file_obj = File.objects.get(id=file_id)
                file_name = file_obj.original_filename
            except Exception:
                file_name = "Unknown"
            
            page = doc.metadata.get('page', 0) + 1
            
            context_part = f"[文檔 {i+1}] 來源: {file_name}, 頁碼: {page}\n{doc.page_content}\n"
            context_parts.append(context_part)
        
        return "\n".join(context_parts)
    
    def get_all_files(self) -> List[Dict[str, Any]]:
        """
        獲取所有文件
        
        Returns:
            文件列表
        """
        try:
            from django.apps import apps
            File = apps.get_model('api', 'File')
            
            files = File.objects.all()
            file_list = []
            
            for file_obj in files:
                file_info = {
                    'id': str(file_obj.id),
                    'original_filename': file_obj.original_filename,
                    'file_path': file_obj.file.path if file_obj.file else '',
                    'file_type': file_obj.file_type,
                    'file_size': file_obj.file_size,
                    'upload_time': file_obj.upload_time.isoformat(),
                    'status': file_obj.status,
                    'chunks_count': file_obj.chunks_count
                }
                file_list.append(file_info)
            
            return file_list
        except Exception as e:
            log_message(f"獲取文件列表時出錯: {str(e)}")
            return []
    
    def add_file_to_db(self, file_id: str, original_filename: str, file_path: str) -> None:
        """
        將文件信息添加到數據庫
        
        Args:
            file_id: 文件ID
            original_filename: 原始文件名
            file_path: 文件路徑
        """
        # 這個方法現在不需要了，因為文件已經在 Django 中創建
        # 保留這個方法是為了向後兼容，但實際上什麼都不做
        log_message(f"add_file_to_db 被調用，但文件 {file_id} 應該已經在 Django 中存在")
    
    def process_file(self, file_id: str, file_path: str) -> None:
        """
        處理文件
        
        Args:
            file_id: 文件ID
            file_path: 文件路徑
        """
        if not os.path.exists(file_path):
            log_message(f"文件不存在: {file_path}")
            # 更新 Django 文件狀態
            try:
                from django.apps import apps
                File = apps.get_model('api', 'File')
                file_obj = File.objects.get(id=file_id)
                file_obj.status = 'error'
                file_obj.save()
            except Exception as e:
                log_message(f"更新文件狀態時出錯: {str(e)}")
            return
        
        # 設置文件狀態為處理中
        try:
            from django.apps import apps
            File = apps.get_model('api', 'File')
            file_obj = File.objects.get(id=file_id)
            file_obj.status = 'processing'
            file_obj.save()
        except Exception as e:
            log_message(f"更新文件狀態時出錯: {str(e)}")
            return
        
        try:
            # 調用文件處理器處理文件
            chunked_documents = self.file_processor.process_file(file_id, file_path)
            
            # 檢查文件狀態
            try:
                file_obj = File.objects.get(id=file_id)
                if file_obj.status == 'cancelled':
                    log_message(f"文件 {file_id} 處理被取消，中止後續操作")
                    return
            except Exception:
                pass
            
            # 如果成功處理，更新 BM25 和狀態
            if chunked_documents:
                if self.settings.get('use_bm25', True):
                    # 再次檢查狀態
                    try:
                        file_obj = File.objects.get(id=file_id)
                        if file_obj.status == 'cancelled':
                            log_message(f"文件 {file_id} 處理被取消，中止 BM25 索引更新")
                            return
                    except Exception:
                        pass
                    self.retrieval_manager._update_bm25_index(chunked_documents)
                
                # 最終檢查狀態並更新
                try:
                    file_obj = File.objects.get(id=file_id)
                    if file_obj.status == 'cancelled':
                        log_message(f"文件 {file_id} 處理被取消，中止狀態更新")
                        return
                    
                    # 更新 Django 資料庫中的狀態
                    file_obj.status = 'processed'
                    file_obj.chunks_count = len(chunked_documents)
                    file_obj.save()
                    log_message(f"成功更新文件 {file_id} 的狀態為 processed，塊數為 {len(chunked_documents)}")
                except Exception as e:
                    log_message(f"更新文件 {file_id} 狀態時出錯: {str(e)}")
            else:
                # 處理失敗，更新狀態為錯誤
                try:
                    file_obj = File.objects.get(id=file_id)
                    file_obj.status = 'error'
                    file_obj.save()
                    log_message(f"文件 {file_id} 處理失敗，狀態已更新為 error")
                except Exception as e:
                    log_message(f"更新文件 {file_id} 狀態時出錯: {str(e)}")
        except Exception as e:
            log_message(f"處理文件 {file_id} 時出錯: {str(e)}")
            # 更新狀態為錯誤
            try:
                file_obj = File.objects.get(id=file_id)
                file_obj.status = 'error'
                file_obj.save()
                log_message(f"文件 {file_id} 處理出錯，狀態已更新為 error")
            except Exception as django_err:
                log_message(f"更新文件 {file_id} 狀態時出錯: {str(django_err)}")
    
    def delete_file_from_vectorstore(self, file_id: str) -> None:
        """
        從向量存儲中刪除文件
        
        Args:
            file_id: 文件ID
        """
        self.vector_manager.delete_file(file_id)
    
    def query(self, question: str, use_different_strategy: bool = False) -> Tuple[str, List[Dict[str, Any]]]:
        """
        查詢RAG系統
        
        Args:
            question: 問題
            use_different_strategy: 是否使用不同的策略（用於重新生成回答）
            
        Returns:
            (回答, 相關文檔列表)
        """
        if self.vector_manager.vectorstore is None:
            return "知識庫尚未初始化，請先上傳文件。", []
        
        if self.llm_manager.llm is None:
            return "LLM未正確初始化，請檢查API密鑰和設置。", []
        
        if use_different_strategy:
            use_hybrid = not self.settings.get('use_hybrid', True)
            use_rag_fusion = not self.settings['use_rag_fusion']
            use_reranking = not self.settings['use_reranking']
            use_cot = not self.settings['use_cot']
        else:
            use_hybrid = self.settings.get('use_hybrid', True)
            use_rag_fusion = self.settings['use_rag_fusion']
            use_reranking = self.settings['use_reranking']
            use_cot = self.settings['use_cot']
        
        if use_hybrid and self.retrieval_manager.bm25_available:
            documents = self.retrieval_manager.hybrid_retrieval(question, use_reranking, self.llm_manager.reranker)
        elif use_rag_fusion:
            documents = self.retrieval_manager.rag_fusion_retrieval(question)
        else:
            documents = self.retrieval_manager.standard_retrieval(question, use_reranking, self.llm_manager.reranker)
        
        if not documents:
            return "我沒有找到與您問題相關的訊息。", []
        
        context = self._format_context(documents)
        
        chain = self.llm_manager.cot_chain if use_cot else self.llm_manager.qa_chain
        response = chain.invoke({"input_documents": documents, "query": question, "context": context})
        answer = response["result"]
        
        related_docs = []
        for i, doc in enumerate(documents):
            file_id = doc.metadata.get('file_id', '')
            
            # 獲取文件信息（先從Django數據庫獲取，失敗則從RAG數據庫獲取）
            file_name = "Unknown"
            try:
                # 嘗試從Django數據庫獲取文件名
                from django.apps import apps
                File = apps.get_model('api', 'File')
                try:
                    file_obj = File.objects.get(id=file_id)
                    file_name = file_obj.original_filename
                except Exception:
                    # 如果Django數據庫獲取失敗，使用預設值
                    file_name = "Unknown"
            except Exception:
                # 如果Django導入失敗，使用預設值
                file_name = "Unknown"
            
            # 提取實際文檔內容
            content = doc.page_content
            if self.settings.get('use_contextual_embeddings', True):
                # 如果使用了上下文嵌入，內容會有格式為"上下文描述\n\n實際內容"
                # 我們只需要提取實際內容部分
                parts = content.split("\n\n", 1)
                if len(parts) > 1:
                    content = parts[1]
            
            # 清理和格式化內容，確保只顯示實際的文檔內容
            # 移除可能的標題、摘要等前綴
            content = self._clean_content_for_display(content)
            
            # 獲取頁面信息（如果有）
            page = doc.metadata.get('page')
            if page is not None:
                # 將頁面從0開始索引轉換為從1開始的頁碼
                page = page + 1
            
            related_docs.append({
                'content': content, # 顯示清理後的完整內容
                'file_id': file_id,
                'file_name': file_name,
                'page': page
            })
        
        return answer, related_docs
    
    def _clean_content_for_display(self, content: str) -> str:
        """
        清理內容以便於顯示
        
        Args:
            content: 原始內容
            
        Returns:
            清理後的內容
        """
        # 移除過長的空白和換行
        content = re.sub(r'\n{3,}', '\n\n', content)
        content = re.sub(r' {2,}', ' ', content)
        
        # 截斷過長的內容，但保留更多上下文
        max_length = 300  # 顯示更多內容
        if len(content) > max_length:
            content = content[:max_length] + '...'
        
        return content.strip()
    
    def add_document(self, file_path: str, file_id: str, original_filename: str) -> bool:
        """
        添加文檔到RAG系統
        
        Args:
            file_path: 文件路徑
            file_id: 文件ID
            original_filename: 原始文件名
            
        Returns:
            是否成功
        """
        chunked_documents = self.file_processor.add_document(file_path, file_id, original_filename)
        if not chunked_documents:
            return False
        
        # 檢查文件狀態
        try:
            from django.apps import apps
            File = apps.get_model('api', 'File')
            file_obj = File.objects.get(id=file_id)
            if file_obj.status == 'cancelled':
                log_message(f"文件 {file_id} 添加被取消，中止後續操作")
                return False
        except Exception:
            pass
        
        if self.settings.get('use_bm25', True):
            self.retrieval_manager._update_bm25_index(chunked_documents)
        
        # 更新 Django 文件狀態
        try:
            file_obj = File.objects.get(id=file_id)
            file_obj.status = 'processed'
            file_obj.chunks_count = len(chunked_documents)
            file_obj.save()
        except Exception as e:
            log_message(f"更新文件狀態時出錯: {str(e)}")
        
        return True
    
    def delete_file(self, file_id: str) -> bool:
        """
        刪除文件
        
        Args:
            file_id: 文件ID
            
        Returns:
            是否成功
        """
        try:
            # 先嘗試從Django模型獲取文件路徑
            file_path = None
            try:
                from django.apps import apps
                File = apps.get_model('api', 'File')
                try:
                    file_obj = File.objects.get(id=file_id)
                    if hasattr(file_obj, 'file') and file_obj.file:
                        file_path = file_obj.file.path
                except File.DoesNotExist:
                    pass
            except Exception:
                # 如果無法從Django模型獲取，繼續執行刪除操作
                pass
            
            # 無論如何都刪除向量庫中的資料
            self.delete_file_from_vectorstore(file_id)
            
            # 只有當文件路徑存在時才嘗試刪除實體檔案
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
                
            log_message(f"成功刪除文件: {file_id}")
            return True
        except Exception as e:
            log_message(f"刪除文件時出錯: {str(e)}")
            return False
    
    def get_settings(self) -> Dict[str, Any]:
        """
        獲取設置
        
        Returns:
            設置字典
        """
        return self.settings
    
    def save_settings(self) -> bool:
        """
        保存設置到數據庫
        
        Returns:
            是否成功
        """
        try:
            from api.models import Setting
            setting_obj = Setting.load()
            
            # 更新設置
            for key, value in self.settings.items():
                if hasattr(setting_obj, key):
                    setattr(setting_obj, key, value)
            
            setting_obj.save()
            log_message("設置已保存到 Django 數據庫")
            return True
        except Exception as e:
            log_message(f"保存設置時出錯: {str(e)}")
            return False
