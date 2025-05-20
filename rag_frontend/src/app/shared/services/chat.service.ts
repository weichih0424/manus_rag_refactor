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
  user_message: string;
  assistant_message: string;
  related_docs: RelatedDoc[];
  show_sources: boolean;
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
  sendMessage(message: string, showSources: boolean): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiUrl}/query/`, {
      question: message,
      show_sources: showSources
    });
  }

  // 重新生成回答
  regenerateAnswer(message: string, id: string, showSources: boolean): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat_history/regenerate/`, {
      question: message,
      id,
      show_sources: showSources
    });
  }

  // 獲取聊天歷史
  getChatHistory(): Observable<ChatResponse[]> {
    return this.http.get<ChatResponse[]>(`${this.apiUrl}/chat_history/`);
  }

  // 清除聊天歷史
  clearChatHistory(): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/chat_history/clear/`);
  }

  // 獲取知識庫狀態
  getKnowledgeBaseStatus(): Observable<KnowledgeBaseStatus> {
    return this.http.get<KnowledgeBaseStatus>(`${this.apiUrl}/knowledge_base/status/`);
  }
} 