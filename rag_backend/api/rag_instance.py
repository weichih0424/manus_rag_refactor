# /home/ubuntu/manus_rag_refactor/backend_merged/api/rag_instance.py
import os
import sys
from django.conf import settings
from .managers.rag_manager import RAGManager # Assuming RAGManager is in api/managers/

BASE_DIR = settings.BASE_DIR
CHROMA_DIR = os.path.join(BASE_DIR, 'chroma_db')

# Determine the correct upload directory for RAGManager to find files
# Django's FileField in the File model saves to MEDIA_ROOT / 'uploads' / <filename>
# MEDIA_ROOT is BASE_DIR / "media"
# So, files are at BASE_DIR / "media" / "uploads" / <filename>
RAG_UPLOAD_DIR_BASE = settings.MEDIA_ROOT # RAGManager might need the root of media files

# 使用 Django 的數據庫路徑作為 RAGManager 的數據庫路徑
RAG_DB_PATH = os.path.join(BASE_DIR, 'db.sqlite3')

# Ensure directories exist
os.makedirs(CHROMA_DIR, exist_ok=True)
# os.makedirs(RAG_UPLOAD_DIR_BASE, exist_ok=True) # MEDIA_ROOT should exist or be created by Django mechanisms
# The specific 'uploads' subdirectory within MEDIA_ROOT will be created by Django's FileField if needed.

# Initialize a singleton RAGManager instance
# The 'upload_dir' for RAGManager in its constructor is a bit ambiguous.
# Given the user's original views.py, it seemed to be a path where files were manually saved before processing.
# Since we are using Django's FileField, the actual file path will be passed to RAGManager's methods.
# Let's pass MEDIA_ROOT as a general base for uploads if RAGManager uses it internally.
rag_manager_singleton = RAGManager(
    chroma_db_dir=CHROMA_DIR,
    upload_dir=str(RAG_UPLOAD_DIR_BASE), # Pass the string representation of Path object
    db_path=RAG_DB_PATH  # 使用 Django 的數據庫路徑
)

# 初始化資料表
# rag_manager_singleton.settings_manager._initialize_settings_table()  # 註解掉 rag.db 的初始化
# rag_manager_singleton.db_manager._initialize_database()  # 註解掉 rag.db 的初始化

