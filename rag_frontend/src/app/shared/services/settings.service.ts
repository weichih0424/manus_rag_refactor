import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SystemSetting {
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  use_rag_fusion: boolean;
  use_reranking: boolean;
  llm_model: string;
  temperature: number;
  max_tokens: number;
  use_cot: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // 獲取系統設置
  getSettings(): Observable<SystemSetting> {
    return this.http.get<SystemSetting>(`${this.apiUrl}/setting/`);
  }

  // 保存系統設置
  saveSettings(setting: SystemSetting): Observable<any> {
    return this.http.post(`${this.apiUrl}/setting/`, setting);
  }
} 