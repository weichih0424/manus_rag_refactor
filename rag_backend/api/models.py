import uuid
from django.db import models
# from django.forms.models import model_to_dict # Not strictly needed here unless used elsewhere

class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=20, default='secondary')
    create_time = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class File(models.Model):
    STATUS_CHOICES = [
        ('uploading', 'Uploading'),
        ('processing', 'Processing'),
        ('processed', 'Processed'),
        ('cancelled', 'Cancelled'),
        ('error', 'Error'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    original_filename = models.CharField(max_length=255)
    # Use FileField to let Django handle file storage relative to MEDIA_ROOT
    file = models.FileField(upload_to='uploads/', max_length=1024) 
    file_type = models.CharField(max_length=10) # e.g., pdf, txt, docx
    file_size = models.BigIntegerField()
    upload_time = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='uploading')
    chunks_count = models.IntegerField(default=0)
    tags = models.ManyToManyField(Tag, blank=True)

    def __str__(self):
        return self.original_filename

class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, default="新對話")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.title

class ChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, related_name='messages', on_delete=models.CASCADE, null=True)
    user_message = models.TextField()
    assistant_message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    related_docs = models.JSONField(null=True, blank=True) # Store related docs info as JSON
    show_sources = models.BooleanField(default=True)

    def __str__(self):
        return f"Chat {self.id} at {self.timestamp}"

class Setting(models.Model):
    # Singleton model for application settings
    id = models.AutoField(primary_key=True) # Ensures pk=1 for singleton
    embedding_model = models.CharField(max_length=255, default='BAAI/bge-large-zh')
    llm_model = models.CharField(max_length=255, default='gpt-3.5-turbo')
    temperature = models.FloatField(default=0.1)
    max_tokens = models.IntegerField(default=1000)
    chunk_size = models.IntegerField(default=1000)
    chunk_overlap = models.IntegerField(default=200)
    top_k = models.IntegerField(default=4)
    use_rag_fusion = models.BooleanField(default=False)
    use_reranking = models.BooleanField(default=False)
    use_cot = models.BooleanField(default=False)
    use_bm25 = models.BooleanField(default=True)
    use_contextual_embeddings = models.BooleanField(default=True)
    use_hybrid = models.BooleanField(default=True)
    use_intelligent_splitting = models.BooleanField(default=True)
    openai_api_key = models.CharField(max_length=255, blank=True, null=True)

    def save(self, *args, **kwargs):
        # Enforce singleton pattern
        self.pk = 1 
        super(Setting, self).save(*args, **kwargs)

    @classmethod
    def load(cls):
        from dotenv import load_dotenv
        import os
        # Ensure .env is loaded from the correct path (Django project root)
        # BASE_DIR should be defined in settings.py, or construct path carefully
        # For simplicity here, assuming .env is discoverable by load_dotenv()
        # In a Django app, this might be better handled at app startup or via Django settings.
        env_file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
        if os.path.exists(env_file_path):
            load_dotenv(dotenv_path=env_file_path)
        else:
            # Fallback if .env is in the api app directory (less ideal)
            load_dotenv()
            
        # 使用 get_or_create 確保有預設資料，如果不存在就創建
        obj, created = cls.objects.get_or_create(
            pk=1,
            defaults={
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
                'use_intelligent_splitting': True,
                'openai_api_key': None
            }
        )
        
        env_api_key = os.getenv('OPENAI_API_KEY')
        # Prioritize env var for API key, update DB if different or not set
        if env_api_key and obj.openai_api_key != env_api_key:
             obj.openai_api_key = env_api_key
             obj.save()
        elif created and env_api_key: # If new instance and env var exists, save it
            obj.openai_api_key = env_api_key
            obj.save()
        return obj

    def __str__(self):
        return "Application Setting"

    def to_dict(self):
        """Converts the model instance to a dictionary, excluding the singleton ID."""
        opts = self._meta
        data = {}
        for f in opts.concrete_fields:
            if f.name == 'id': # Exclude the primary key used for singleton
                continue
            # For security, consider masking API key if this dict is exposed directly
            # However, RAGManager might need the actual key.
            data[f.name] = f.value_from_object(self)
        return data

