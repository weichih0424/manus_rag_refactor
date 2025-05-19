"""
Vector Manager - 向量存儲管理
負責初始化和管理向量數據庫
"""
import os
import sys
from typing import List, Optional
from langchain_chroma import Chroma
from langchain.schema import Document

# 自定義日誌函數，確保輸出後立即刷新
def log_message(message):
    """輸出日誌並立即刷新緩衝區"""
    print(message, flush=True)

class VectorManager:
    """向量管理器類，負責向量存儲的初始化和管理"""
    
    def __init__(self, chroma_db_dir: str, embeddings: any):
        """
        初始化向量管理器
        
        Args:
            chroma_db_dir: ChromaDB目錄
            embeddings: 嵌入模型
        """
        self.chroma_db_dir = chroma_db_dir
        self.embeddings = embeddings
        
        # 初始化向量存儲
        if os.path.exists(self.chroma_db_dir):
            self.vectorstore = Chroma(
                persist_directory=self.chroma_db_dir,
                embedding_function=self.embeddings
            )
            log_message(f"已加載現有向量數據庫: {self.chroma_db_dir}")
        else:
            self.vectorstore = None
            log_message(f"向量數據庫尚未初始化，將在添加文檔時創建")
    
    def add_documents(self, documents: List[Document]) -> None:
        """
        將文檔添加到向量存儲
        
        Args:
            documents: 文檔列表
        """
        if not documents:
            log_message("沒有文檔可添加")
            return
        
        # 檢查所有文檔是否都有 file_id 元數據
        for doc in documents:
            if 'file_id' not in doc.metadata or not doc.metadata['file_id']:
                log_message("警告: 發現缺少 file_id 的文檔，這可能導致無法正確刪除文檔")
        
        if self.vectorstore is None:
            self.vectorstore = Chroma.from_documents(
                documents=documents,
                embedding=self.embeddings,
                persist_directory=self.chroma_db_dir
            )
            log_message(f"已創建新的向量數據庫並添加 {len(documents)} 個文檔")
        else:
            self.vectorstore.add_documents(documents)
            log_message(f"已向現有向量數據庫添加 {len(documents)} 個文檔")
        
        log_message("向量數據庫已持久化")
    
    def check_missing_file_ids(self):
        """檢查向量庫中缺少 file_id 元數據的文檔
        
        Returns:
            List: 沒有 file_id 的文檔 ID 列表
        """
        if not self.vectorstore or not hasattr(self.vectorstore, '_collection'):
            return []
            
        try:
            # 取得所有元數據
            collection_data = self.vectorstore._collection.get(include=["metadatas"])
            all_ids = collection_data['ids']
            all_metadatas = collection_data['metadatas']
            
            missing_file_id_docs = []
            for idx, metadata in enumerate(all_metadatas):
                if 'file_id' not in metadata or not metadata['file_id']:
                    missing_file_id_docs.append(all_ids[idx])
            
            log_message(f"發現 {len(missing_file_id_docs)} 個缺少 file_id 的文檔")
            return missing_file_id_docs
        except Exception as e:
            log_message(f"檢查缺少 file_id 的文檔時出錯: {str(e)}")
            return []
    
    def delete_documents_without_file_id(self):
        """刪除沒有 file_id 的向量文檔
        
        Returns:
            int: 刪除的文檔數量
        """
        if not self.vectorstore or not hasattr(self.vectorstore, '_collection'):
            return 0
            
        try:
            # 刪除沒有 file_id 的文檔
            missing_ids = self.check_missing_file_ids()
            if missing_ids:
                self.vectorstore._collection.delete(ids=missing_ids)
                log_message(f"已刪除 {len(missing_ids)} 個缺少 file_id 的文檔")
                return len(missing_ids)
            return 0
        except Exception as e:
            log_message(f"刪除缺少 file_id 的文檔時出錯: {str(e)}")
            return 0
    
    def delete_documents_by_source(self, source_path: str) -> int:
        """
        根據文件路徑刪除相關文檔
        
        Args:
            source_path: 文件路徑
            
        Returns:
            int: 刪除的文檔數量
        """
        if self.vectorstore is None or not hasattr(self.vectorstore, '_collection'):
            log_message("向量數據庫尚未初始化")
            return 0
        
        try:
            # 規範化路徑，確保一致性
            normalized_path = os.path.normpath(source_path)
            
            # 查詢源路徑匹配的文檔
            try:
                # 使用新版API方式查詢
                collection_data = self.vectorstore._collection.get(
                    where={"source": normalized_path},
                    include=["metadatas", "documents"]
                )
                
                if collection_data and len(collection_data['ids']) > 0:
                    # 有匹配的文檔，直接刪除
                    result = self.vectorstore._collection.delete(where={"source": normalized_path})
                    deleted_count = result.get('deleted', 0) if result else 0
                    log_message(f"已從向量數據庫中刪除源路徑 {source_path} 的 {deleted_count} 個文檔")
                    return deleted_count
            except Exception as e:
                log_message(f"使用where查詢時出錯: {str(e)}，嘗試備用方法")
            
            # 備用方法：獲取所有文檔然後過濾
            try:
                # 獲取所有文檔但只包含metadata
                all_data = self.vectorstore._collection.get(include=["metadatas"])
                
                # 如果沒有數據或IDs，直接返回
                if not all_data or 'ids' not in all_data or not all_data['ids']:
                    log_message(f"未找到任何文檔")
                    return 0
                    
                # 尋找匹配的文檔ID
                all_ids = []
                for idx, metadata in enumerate(all_data['metadatas']):
                    source = metadata.get('source', '')
                    if source and (source == source_path or source.endswith(source_path)):
                        all_ids.append(all_data['ids'][idx])
                
                # 如果找到匹配的ID，刪除它們
                if all_ids:
                    result = self.vectorstore._collection.delete(ids=all_ids)
                    deleted_count = result.get('deleted', 0) if result else 0
                    log_message(f"已從向量數據庫中刪除源路徑 {source_path} 的 {deleted_count} 個文檔")
                    return deleted_count
                else:
                    log_message(f"源路徑 {source_path} 沒有現有文檔需要刪除，將繼續添加新文檔")
                    return 0
            except Exception as e:
                log_message(f"使用備用方法查詢時出錯: {str(e)}")
                return 0
                
        except Exception as e:
            log_message(f"刪除源路徑 {source_path} 的文檔時出錯: {str(e)}")
            import traceback
            traceback.print_exc()
            return 0
    
    def delete_file(self, file_id: str) -> None:
        """
        從向量存儲中刪除文件
        
        Args:
            file_id: 文件ID
        """
        if self.vectorstore is None:
            log_message("向量數據庫尚未初始化")
            return
        
        # 刪除指定 file_id 的文檔
        try:
            # 使用更安全的方法刪除文件
            result = self.vectorstore._collection.delete(where={"file_id": file_id})
            # 確保result不是None再訪問其方法
            deleted_count = 0
            if result is not None:
                deleted_count = result.get('deleted', 0)
            log_message(f"已從向量數據庫中刪除文件 {file_id} 的 {deleted_count} 個文檔")
        except Exception as e:
            log_message(f"刪除文件 {file_id} 的文檔時出錯: {str(e)}")
            # 即使出錯也繼續處理，不中斷整體刪除流程
    
    def update_embeddings(self, embeddings: any) -> None:
        """
        更新嵌入模型並重新初始化向量存儲
        
        Args:
            embeddings: 新的嵌入模型
        """
        self.embeddings = embeddings
        if self.vectorstore is not None:
            self.vectorstore = Chroma(
                persist_directory=self.chroma_db_dir,
                embedding_function=self.embeddings
            )
            log_message(f"已更新嵌入模型並重新加載向量數據庫: {self.chroma_db_dir}")

    def get_document_count(self) -> int:
        """獲取向量庫中的文檔總數

        Returns:
            int: 文檔數量
        """
        if not self.vectorstore:
            return 0
            
        try:
            # 對於ChromaDB，可以通過_collection.count()獲取文檔數量
            if hasattr(self.vectorstore, '_collection'):
                return self.vectorstore._collection.count()
            return 0
        except Exception as e:
            log_message(f"獲取文檔數量時出錯: {str(e)}")
            return 0
            
    def maintenance(self):
        """執行向量庫維護，檢查和修復元數據問題"""
        if not self.vectorstore:
            log_message("向量數據庫尚未初始化，無法執行維護")
            return
            
        # 刪除沒有 file_id 的文檔
        cleaned_count = self.delete_documents_without_file_id()
        
        # 取得向量庫中的總文檔數
        total_count = self.get_document_count()
        
        log_message(f"向量庫維護完成: 總文檔數 {total_count}, 已清理 {cleaned_count} 個缺少 file_id 的文檔")