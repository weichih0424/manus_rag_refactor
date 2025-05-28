from django.core.management.base import BaseCommand
from api.models import Setting

class Command(BaseCommand):
    help = '初始化系統設置'

    def handle(self, *args, **options):
        if Setting.objects.exists():
            self.stdout.write(self.style.WARNING('設置已經存在，跳過初始化'))
            return

        setting = Setting.objects.create(
            embedding_model='BAAI/bge-large-zh',
            llm_model='gpt-3.5-turbo',
            temperature=0.1,
            max_tokens=1000,
            chunk_size=1000,
            chunk_overlap=200,
            top_k=4,
            use_rag_fusion=False,
            use_reranking=False,
            use_cot=False,
            use_bm25=True,
            use_contextual_embeddings=True,
            use_hybrid=True,
            use_intelligent_splitting=True
        )

        self.stdout.write(self.style.SUCCESS('成功創建系統設置'))
        self.stdout.write(f'嵌入模型: {setting.embedding_model}')
        self.stdout.write(f'語言模型: {setting.llm_model}')
        self.stdout.write(f'溫度: {setting.temperature}') 