import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface RelatedDoc {
  file_name: string;
  content: string;
  page?: number;
  file_id?: string;
}

export interface ChatResponse {
  id: string;
  conversation_id?: string;
  user_message: string;
  assistant_message: string;
  related_docs: RelatedDoc[];
  show_sources: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseStatus {
  files_count: number;
  chunks_count: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // 發送聊天訊息
  sendMessage(message: string, conversationId: string | null = null, showSources: boolean = true): Observable<ChatResponse> {
    const payload: any = {
      question: message,
      show_sources: showSources
    };
    
    // 如果有對話ID，則添加到請求中
    if (conversationId) {
      payload.conversation_id = conversationId;
    }
    
    return this.http.post<ChatResponse>(`${this.apiUrl}/query/`, payload);
  }

  // 重新生成回答
  regenerateAnswer(message: string, id: string, showSources: boolean, conversationId: string | null = null): Observable<ChatResponse> {
    const payload: any = {
      question: message,
      id,
      show_sources: showSources
    };
    
    // 如果提供了對話ID，添加到請求中
    if (conversationId) {
      payload.conversation_id = conversationId;
    }
    
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat_history/regenerate/`, payload);
  }

  // 獲取聊天歷史
  getChatHistory(conversationId: string | null = null): Observable<ChatResponse[]> {
    let url = `${this.apiUrl}/chat_history/`;
    if (conversationId) {
      url = `${this.apiUrl}/conversations/${conversationId}/messages/`;
    }
    return this.http.get<ChatResponse[]>(url);
  }

  // 清除聊天歷史
  clearChatHistory(conversationId: string | null = null): Observable<{ success: boolean }> {
    if (conversationId) {
      return this.http.delete<{ success: boolean }>(`${this.apiUrl}/conversations/${conversationId}/clear_messages/`);
    }
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/chat_history/clear/`);
  }

  // 獲取所有對話
  getConversations(): Observable<Conversation[]> {
    return this.http.get<Conversation[]>(`${this.apiUrl}/conversations/`);
  }

  // 創建新對話
  createConversation(title: string): Observable<Conversation> {
    return this.http.post<Conversation>(`${this.apiUrl}/conversations/`, { title });
  }

  // 更新對話標題
  updateConversationTitle(id: string, title: string): Observable<Conversation> {
    return this.http.patch<Conversation>(`${this.apiUrl}/conversations/${id}/`, { title });
  }

  // 刪除對話
  deleteConversation(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/conversations/${id}/`);
  }

  // 獲取知識庫狀態
  getKnowledgeBaseStatus(): Observable<KnowledgeBaseStatus> {
    return this.http.get<KnowledgeBaseStatus>(`${this.apiUrl}/knowledge_base/status/`);
  }
} 