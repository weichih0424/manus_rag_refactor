# /home/ubuntu/manus_rag_refactor/backend_merged/api/serializers.py
from rest_framework import serializers
from .models import Tag, File, ChatMessage, Settings as SettingsModel # Renamed to avoid conflict

# 通用響應序列化器
class StatusResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    error = serializers.CharField(required=False, allow_null=True)

class SuccessResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    message = serializers.CharField(required=False, allow_null=True)

class EmptySerializer(serializers.Serializer):
    pass

# Serializer from user (simple, for reference or specific use cases if needed)
class UserFileInfoSerializer(serializers.Serializer):
    id = serializers.CharField()
    original_filename = serializers.CharField()
    file_path = serializers.CharField() # This might be sensitive or not directly applicable with Django FileField
    upload_time = serializers.CharField()
    status = serializers.CharField()
    chunks_count = serializers.IntegerField()

class QuerySerializer(serializers.Serializer): # Kept from user, as it is simple and used in QueryView
    question = serializers.CharField(required=True)
    id = serializers.CharField(required=False)
    show_sources = serializers.BooleanField(required=False, default=True)

class QueryResultSerializer(serializers.Serializer): # Kept from user, as it is simple and used in QueryView
    answer = serializers.CharField()
    related_docs = serializers.ListField()

# More comprehensive serializers based on my previous version, adapted for merged models
class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'name', 'color', 'create_time']

class FileSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = File
        fields = ['id', 'original_filename', 'file_type', 'file_size', 'upload_time', 'status', 'chunks_count', 'tags', 'file_url']
        read_only_fields = ['id', 'file_url']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if request and obj.file:
            return request.build_absolute_uri(obj.file.url)
        return None

class FileUploadSerializer(serializers.Serializer):
    file = serializers.FileField()

class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = ['id', 'user_message', 'assistant_message', 'timestamp', 'related_docs', 'show_sources']
        read_only_fields = ['id', 'timestamp']

class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SettingsModel # Use the aliased SettingsModel
        fields = [
            'embedding_model', 'llm_model', 'temperature', 'max_tokens',
            'chunk_size', 'chunk_overlap', 'top_k', 'use_rag_fusion',
            'use_reranking', 'use_cot', 'use_bm25', 'use_contextual_embeddings',
            'use_hybrid', 'use_intelligent_splitting', 'openai_api_key'
        ]

    def to_representation(self, instance):
        # 在返回序列化數據前去除API密鑰
        data = super().to_representation(instance)
        if 'openai_api_key' in data:
            # 只返回密鑰是否已配置的信息，而不是實際密鑰
            data['openai_api_key_set'] = bool(data['openai_api_key'])
            del data['openai_api_key']
        return data

class FileTagsSerializer(serializers.Serializer):
    """
    用於標籤操作的序列化器
    接收文件ID列表和標籤名稱列表
    """
    file_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=True
    )
    tags = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=True
    )

# 知識庫狀態序列化器
class KnowledgeBaseStatusSerializer(serializers.Serializer):
    total_files = serializers.IntegerField()
    processed_files = serializers.IntegerField()
    vector_count = serializers.IntegerField()
    files_count = serializers.IntegerField()
    chunks_count = serializers.IntegerField()
    is_ready = serializers.BooleanField()
    last_updated = serializers.DateTimeField()

# 向量庫維護響應序列化器
class VectorstoreMaintenanceResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    message = serializers.CharField()
    document_count = serializers.IntegerField()

