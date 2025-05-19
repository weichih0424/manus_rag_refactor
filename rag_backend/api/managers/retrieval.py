"""
Retrieval - 檢索策略管理
包含標準檢索、混合檢索和 RAG Fusion 檢索
"""
from typing import List, Optional
from langchain.schema import Document
from langchain.retrievers import ContextualCompressionRetriever

class RetrievalManager:
    """檢索管理器類，負責處理不同的檢索策略"""
    
    def __init__(self, vector_manager: Optional[any], llm: any, settings: dict):
        """
        初始化檢索管理器
        
        Args:
            vector_manager: 向量管理器對象
            llm: LLM對象（用於查詢擴展和重排序）
            settings: 配置設置字典
        """
        self.vector_manager = vector_manager
        self.llm = llm
        self.settings = settings
        
        # 初始化BM25相關屬性
        self.bm25_available = False
        self.bm25_index = None
        self.bm25_documents = []
        self._initialize_bm25()

    def _initialize_bm25(self) -> None:
        """
        初始化 BM25 索引
        """
        try:
            import jieba
            from rank_bm25 import BM25Okapi
            import numpy as np
            
            self.bm25_available = True
            self.bm25_index = None
            self.bm25_documents = []
            
            print("BM25 索引初始化成功")
        except ImportError as e:
            print(f"BM25 索引初始化失敗，缺少必要的庫: {str(e)}")
            print("請使用 pip install jieba rank_bm25 numpy 安裝必要的庫")
            self.bm25_available = False

    def _update_bm25_index(self, documents: List[Document]) -> None:
        """
        更新 BM25 索引
        
        Args:
            documents: 文檔列表
        """
        if not self.bm25_available:
            return
            
        try:
            import jieba
            from rank_bm25 import BM25Okapi
            
            self.bm25_documents.extend(documents)
            tokenized_documents = [list(jieba.cut(doc.page_content)) for doc in self.bm25_documents]
            self.bm25_index = BM25Okapi(tokenized_documents)
            print(f"BM25 索引已更新，共包含 {len(self.bm25_documents)} 個文檔")
        except Exception as e:
            print(f"更新 BM25 索引時出錯: {str(e)}")

    def _bm25_search(self, query: str, top_k: int = 5) -> List[Document]:
        """
        使用 BM25 搜索
        
        Args:
            query: 查詢
            top_k: 返回的文檔數量
            
        Returns:
            文檔列表
        """
        if not self.bm25_available or self.bm25_index is None:
            return []
            
        try:
            import jieba
            import numpy as np
            
            tokenized_query = list(jieba.cut(query))
            scores = self.bm25_index.get_scores(tokenized_query)
            top_indices = np.argsort(scores)[::-1][:top_k]
            return [self.bm25_documents[i] for i in top_indices]
        except Exception as e:
            print(f"BM25 搜索時出錯: {str(e)}")
            return []

    def standard_retrieval(self, query: str, use_reranking: bool = False, reranker: Optional[any] = None) -> List[Document]:
        """
        標準檢索
        
        Args:
            query: 查詢
            use_reranking: 是否使用重排序
            reranker: 重排序器（可選）
            
        Returns:
            文檔列表
        """
        if self.vector_manager.vectorstore is None:
            return []
            
        retriever = self.vector_manager.vectorstore.as_retriever(search_kwargs={"k": self.settings['top_k']})
        if use_reranking and reranker:
            compression_retriever = ContextualCompressionRetriever(
                base_retriever=retriever,
                doc_compressor=reranker
            )
            return compression_retriever.invoke(query)
        return retriever.invoke(query)

    def hybrid_retrieval(self, query: str, use_reranking: bool = False, reranker: Optional[any] = None) -> List[Document]:
        """
        混合檢索策略，結合向量檢索和 BM25
        
        Args:
            query: 查詢
            use_reranking: 是否使用重排序
            reranker: 重排序器（可選）
            
        Returns:
            文檔列表
        """
        if self.vector_manager.vectorstore is None:
            return []
            
        vector_retriever = self.vector_manager.vectorstore.as_retriever(search_kwargs={"k": self.settings['top_k']})
        vector_docs = vector_retriever.invoke(query)
        bm25_docs = self._bm25_search(query, top_k=self.settings['top_k'])
        
        all_docs = vector_docs + bm25_docs
        unique_docs = {}
        for doc in all_docs:
            key = doc.page_content[:100]
            if key not in unique_docs or len(doc.page_content) > len(unique_docs[key].page_content):
                unique_docs[key] = doc
        
        docs = list(unique_docs.values())[:self.settings['top_k']]
        
        if use_reranking and reranker:
            compression_retriever = ContextualCompressionRetriever(
                base_retriever=lambda x: docs,
                doc_compressor=reranker
            )
            return compression_retriever.invoke(query)
        return docs

    def rag_fusion_retrieval(self, query: str) -> List[Document]:
        """
        RAG Fusion 檢索
        
        Args:
            query: 查詢
            
        Returns:
            文檔列表
        """
        expanded_queries = self._query_expansion(query)
        all_docs = []
        for q in expanded_queries:
            docs = self.standard_retrieval(q)
            all_docs.extend(docs)
        
        unique_docs = {}
        for doc in all_docs:
            key = doc.page_content[:100]
            if key not in unique_docs:
                unique_docs[key] = doc
        
        return list(unique_docs.values())[:self.settings['top_k']]

    def _query_expansion(self, query: str, num_expansions: int = 3) -> List[str]:
        """
        查詢擴展
        
        Args:
            query: 查詢
            num_expansions: 擴展查詢數量
            
        Returns:
            擴展查詢列表
        """
        if self.llm is None:
            print("LLM未初始化，無法進行查詢擴展")
            return [query]
        
        prompt = f"""
        你是一個專業的查詢擴展助手。你的任務是生成多個不同的查詢，這些查詢與原始查詢表達相同的意思，但使用不同的詞彙和表達方式。
        
        原始查詢: {query}
        
        請生成 {num_expansions} 個不同的查詢，每個查詢一行，格式如下:
        1. 擴展查詢1
        2. 擴展查詢2
        3. 擴展查詢3
        
        只返回擴展查詢，不要有其他解釋或說明。
        """
        
        try:
            response = self.llm.predict(prompt)
            expanded_queries = []
            for line in response.strip().split('\n'):
                line = line.strip()
                if line and ('.' in line or ':' in line):
                    query_text = line[line.find('.') + 1:].strip() if '.' in line else line[line.find(':') + 1:].strip()
                    expanded_queries.append(query_text)
            
            if not expanded_queries:
                expanded_queries = [query]
            if query not in expanded_queries:
                expanded_queries.insert(0, query)
            return expanded_queries
        except Exception as e:
            print(f"查詢擴展時出錯: {str(e)}")
            return [query]