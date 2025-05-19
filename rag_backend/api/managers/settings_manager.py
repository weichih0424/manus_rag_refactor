"""
Settings Manager - 設置管理
負責設置的加載、保存和更新
"""
from typing import Dict, Any
import sqlite3

class SettingsManager:
    """設置管理器類，負責設置的加載、保存和更新"""
    
    def __init__(self, db_path: str):
        """
        初始化設置管理器
        
        Args:
            db_path: SQLite 數據庫路徑
        """
        self.db_path = db_path
        self.default_settings = {
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
        self._initialize_settings_table()

    def _initialize_settings_table(self) -> None:
        """
        初始化設置表
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY,
                embedding_model TEXT,
                llm_model TEXT,
                temperature REAL,
                max_tokens INTEGER,
                chunk_size INTEGER,
                chunk_overlap INTEGER,
                top_k INTEGER,
                use_rag_fusion INTEGER,
                use_reranking INTEGER,
                use_cot INTEGER,
                use_bm25 INTEGER,
                use_contextual_embeddings INTEGER,
                use_hybrid INTEGER,
                use_intelligent_splitting INTEGER
            )
            ''')
            conn.commit()
            print("設置表已初始化")
        except Exception as e:
            print(f"初始化設置表時出錯: {str(e)}")
        finally:
            conn.close()

    def load_settings(self) -> Dict[str, Any]:
        """
        從數據庫加載設置
        
        Returns:
            設置字典
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT * FROM settings LIMIT 1')
            settings = dict(cursor.fetchone() or {})
            
            if not settings:
                return self.default_settings.copy()
            
            # 將布爾值轉換為 Python 布爾值
            for key in ['use_rag_fusion', 'use_reranking', 'use_cot', 'use_bm25', 'use_contextual_embeddings', 'use_hybrid', 'use_intelligent_splitting']:
                if key in settings:
                    settings[key] = bool(settings[key])
                
            # 確保所有默認設置的鍵都存在
            for key, value in self.default_settings.items():
                if key not in settings:
                    settings[key] = value
                    
            return settings
        except Exception as e:
            print(f"加載設置時出錯: {str(e)}")
            return self.default_settings.copy()
        finally:
            conn.close()

    def save_settings(self, settings: Dict[str, Any]) -> bool:
        """
        保存設置到數據庫
        
        Args:
            settings: 設置字典
            
        Returns:
            是否成功
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT COUNT(*) FROM settings")
            count = cursor.fetchone()[0]
            
            if count == 0:
                cursor.execute('''
                INSERT INTO settings (
                    embedding_model, llm_model, temperature, max_tokens,
                    chunk_size, chunk_overlap, top_k,
                    use_rag_fusion, use_reranking, use_cot,
                    use_bm25, use_contextual_embeddings, use_hybrid, use_intelligent_splitting
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    settings['embedding_model'],
                    settings['llm_model'],
                    settings['temperature'],
                    settings['max_tokens'],
                    settings['chunk_size'],
                    settings['chunk_overlap'],
                    settings['top_k'],
                    int(settings['use_rag_fusion']),
                    int(settings['use_reranking']),
                    int(settings['use_cot']),
                    int(settings.get('use_bm25', True)),
                    int(settings.get('use_contextual_embeddings', True)),
                    int(settings.get('use_hybrid', True)),
                    int(settings.get('use_intelligent_splitting', True))
                ))
            else:
                cursor.execute('''
                UPDATE settings SET
                    embedding_model = ?,
                    llm_model = ?,
                    temperature = ?,
                    max_tokens = ?,
                    chunk_size = ?,
                    chunk_overlap = ?,
                    top_k = ?,
                    use_rag_fusion = ?,
                    use_reranking = ?,
                    use_cot = ?,
                    use_bm25 = ?,
                    use_contextual_embeddings = ?,
                    use_hybrid = ?,
                    use_intelligent_splitting = ?
                WHERE id = 1
                ''', (
                    settings['embedding_model'],
                    settings['llm_model'],
                    settings['temperature'],
                    settings['max_tokens'],
                    settings['chunk_size'],
                    settings['chunk_overlap'],
                    settings['top_k'],
                    int(settings['use_rag_fusion']),
                    int(settings['use_reranking']),
                    int(settings['use_cot']),
                    int(settings.get('use_bm25', True)),
                    int(settings.get('use_contextual_embeddings', True)),
                    int(settings.get('use_hybrid', True)),
                    int(settings.get('use_intelligent_splitting', True))
                ))
            
            conn.commit()
            print("設置已保存到數據庫")
            return True
        except Exception as e:
            print(f"保存設置時出錯: {str(e)}")
            return False
        finally:
            conn.close()