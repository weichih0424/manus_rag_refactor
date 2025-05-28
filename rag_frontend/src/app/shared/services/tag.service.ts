import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TagModel } from '../models/file.model';

@Injectable({
  providedIn: 'root'
})
export class TagService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  // 獲取所有標籤
  getTags(): Observable<TagModel[]> {
    return this.http.get<TagModel[]>(`${this.apiUrl}/tag/`);
  }
  
  // 新增標籤 - 返回Django REST框架創建的標籤對象
  addTag(tag: TagModel): Observable<TagModel> {
    return this.http.post<TagModel>(`${this.apiUrl}/tag/`, tag);
  }
  
  // 刪除標籤 - Django REST框架通常返回204 No Content
  deleteTag(tagId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/tag/${tagId}/`);
  }
} 