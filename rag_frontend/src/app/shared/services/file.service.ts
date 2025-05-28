import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { FileModel, KnowledgeBaseStatus } from '../models/file.model';
import { catchError, of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FileService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // 獲取所有文件
  getFiles(): Observable<FileModel[]> {
    return this.http.get<FileModel[]>(`${this.apiUrl}/file/`);
  }

  // 獲取知識庫狀態
  getKnowledgeBaseStatus(): Observable<KnowledgeBaseStatus> {
    return this.http.get<KnowledgeBaseStatus>(`${this.apiUrl}/knowledge_base/status/`);
  }

  // 刪除文件
  deleteFile(fileId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/file/${fileId}/`);
  }

  // 取消文件處理
  cancelProcessing(fileId: string): Observable<any> {
    console.log(`向後端API發送取消處理請求: ${fileId}`);
    return this.http.post(`${this.apiUrl}/file/${fileId}/cancel_processing/`, {})
      .pipe(
        catchError(error => {
          console.error(`取消處理API失敗: ${error.message || error}`);
          // 即使API失敗，依然返回成功響應，讓前端保持取消狀態
          return of({ success: true, status: 'cancelled', message: '前端已標記為取消' });
        })
      );
  }

  // 檢查單個文件狀態（強制同步）
  getFileStatus(fileId: string): Observable<FileModel> {
    return this.http.get<FileModel>(`${this.apiUrl}/file/${fileId}/check_status/`);
  }

  // 應用標籤
  applyTags(fileIds: string[], tags: any[]): Observable<any> {
    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json'
      })
    };
    
    // 確保tags中的每個標籤都是字符串
    const processedTags = tags.map(tag => typeof tag === 'string' ? tag : (tag && tag.name ? tag.name : tag));
    
    return this.http.post(`${this.apiUrl}/file/tags/`, { file_ids: fileIds, tags: processedTags }, httpOptions);
  }

  // 移除標籤
  removeTags(fileIds: string[], tags: any[]): Observable<any> {
    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json'
      })
    };
    
    // 確保tags中的每個標籤都是字符串
    const processedTags = tags.map(tag => typeof tag === 'string' ? tag : (tag && tag.name ? tag.name : tag));
    
    return this.http.post(`${this.apiUrl}/file/remove_tags/`, { file_ids: fileIds, tags: processedTags }, httpOptions);
  }

  // 上傳文件（使用XMLHttpRequest以支持進度監控）
  uploadFile(file: File, onProgress?: (percent: number) => void): Promise<any> & { xhr: XMLHttpRequest } {
    const xhr = new XMLHttpRequest();
    
    // 創建具有 xhr 屬性的 Promise
    const promise = new Promise<any>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      xhr.open('POST', `${this.apiUrl}/file/upload_file/`, true);
      xhr.withCredentials = true; // 添加跨域憑證支持

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {  // 接受 200 OK 或 201 Created
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject('上傳成功但解析響應失敗');
          }
        } else {
          reject(`上傳失敗: ${xhr.statusText}`);
        }
      };

      xhr.onerror = () => {
        reject('上傳失敗: 網絡錯誤');
      };

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            onProgress(percentComplete);
          }
        };
      }

      xhr.send(formData);
    }) as Promise<any> & { xhr: XMLHttpRequest };
    
    // 將 xhr 物件附加到 Promise 上
    (promise as any).xhr = xhr;
    
    return promise as Promise<any> & { xhr: XMLHttpRequest };
  }
} 