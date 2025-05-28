"""
Database Manager - 數據庫管理
負責 SQLite 數據庫的文件操作
"""
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional

class DatabaseManager:
    """數據庫管理器類，負責 SQLite 數據庫的文件操作"""
    
    def __init__(self, db_path: str):
        """
        初始化數據庫管理器
        
        Args:
            db_path: SQLite 數據庫路徑
        """
        self.db_path = db_path
        # self._initialize_database()

    def _initialize_database(self) -> None:
        """
        初始化數據庫，創建必要的表
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 創建 file 表
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS file (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                upload_time TIMESTAMP NOT NULL,
                status TEXT NOT NULL,
                chunks_count INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]'
            )
            ''')
            
            # 創建 tags 表
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT 'secondary',
                create_time TIMESTAMP NOT NULL
            )
            ''')
            
            # 創建 chat_history 表
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_history (
                id TEXT PRIMARY KEY,
                user_message TEXT NOT NULL,
                assistant_message TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                related_docs TEXT,
                show_sources INTEGER NOT NULL DEFAULT 1
            )
            ''')
            
            # 創建 settings 表
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY,
                embedding_model TEXT NOT NULL DEFAULT 'BAAI/bge-large-zh',
                llm_model TEXT NOT NULL DEFAULT 'gpt-3.5-turbo',
                temperature REAL NOT NULL DEFAULT 0.1,
                max_tokens INTEGER NOT NULL DEFAULT 1000,
                chunk_size INTEGER NOT NULL DEFAULT 1000,
                chunk_overlap INTEGER NOT NULL DEFAULT 200,
                top_k INTEGER NOT NULL DEFAULT 4,
                use_rag_fusion INTEGER NOT NULL DEFAULT 0,
                use_reranking INTEGER NOT NULL DEFAULT 0,
                use_cot INTEGER NOT NULL DEFAULT 0,
                use_bm25 INTEGER NOT NULL DEFAULT 1,
                use_contextual_embeddings INTEGER NOT NULL DEFAULT 1,
                use_hybrid INTEGER NOT NULL DEFAULT 1,
                use_intelligent_splitting INTEGER NOT NULL DEFAULT 1
            )
            ''')
            
            # 插入默認設置
            cursor.execute('SELECT COUNT(*) FROM settings')
            if cursor.fetchone()[0] == 0:
                cursor.execute('''
                INSERT INTO settings (
                    embedding_model, llm_model, temperature, max_tokens, 
                    chunk_size, chunk_overlap, top_k, use_rag_fusion, 
                    use_reranking, use_cot, use_bm25, use_contextual_embeddings,
                    use_hybrid, use_intelligent_splitting
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    'BAAI/bge-large-zh',
                    'gpt-3.5-turbo',
                    0.1,
                    1000,
                    1000,
                    200,
                    4,
                    0,
                    0,
                    0,
                    1,
                    1,
                    1,
                    1
                ))
            
            conn.commit()
            print(f"文件數據庫已初始化: {self.db_path}")
        except Exception as e:
            print(f"初始化數據庫時出錯: {str(e)}")
        finally:
            conn.close()

    def get_file_info(self, file_id: str) -> Optional[Dict[str, Any]]:
        """
        獲取文件信息
        
        Args:
            file_id: 文件ID
            
        Returns:
            文件信息
        """
        if not file_id:
            return None
            
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT * FROM file WHERE id = ?', (file_id,))
            file_info = cursor.fetchone()
            return dict(file_info) if file_info else None
        except Exception as e:
            print(f"獲取文件信息時出錯: {str(e)}")
            return None
        finally:
            conn.close()

    def get_all_files(self) -> List[Dict[str, Any]]:
        """
        獲取所有文件
        
        Returns:
            文件列表
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT * FROM file ORDER BY upload_time DESC')
            files = cursor.fetchall()
            return [dict(file) for file in files]
        except Exception as e:
            print(f"獲取文件列表時出錯: {str(e)}")
            return []
        finally:
            conn.close()

    def add_file(self, file_id: str, original_filename: str, file_path: str, status: str = 'pending', chunks_count: int = 0) -> None:
        """
        將文件信息添加到數據庫
        
        Args:
            file_id: 文件ID
            original_filename: 原始文件名
            file_path: 文件路徑
            status: 文件狀態
            chunks_count: 文檔塊數量
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
            INSERT INTO file (id, original_filename, file_path, upload_time, status, chunks_count)
            VALUES (?, ?, ?, ?, ?, ?)
            ''', (file_id, original_filename, file_path, datetime.now().isoformat(), status, chunks_count))
            conn.commit()
        except Exception as e:
            print(f"添加文件信息到數據庫時出錯: {str(e)}")
        finally:
            conn.close()

    def update_file_status(self, file_id: str, status: str, chunks_count: int = 0) -> None:
        """
        更新文件狀態
        
        Args:
            file_id: 文件ID
            status: 狀態
            chunks_count: 文檔塊數量
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute('''
            UPDATE file 
            SET status = ?, chunks_count = ?
            WHERE id = ?
            ''', (status, chunks_count, file_id))
            conn.commit()
        except Exception as e:
            print(f"更新文件狀態時出錯: {str(e)}")
        finally:
            conn.close()

    def delete_file(self, file_id: str) -> bool:
        """
        從數據庫中刪除文件記錄
        
        Args:
            file_id: 文件ID
            
        Returns:
            是否成功
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM file WHERE id = ?', (file_id,))
            conn.commit()
            return True
        except Exception as e:
            print(f"刪除文件記錄時出錯: {str(e)}")
            return False
        finally:
            conn.close()