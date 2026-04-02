'use client';

import React, { useState } from 'react';
import { Upload, Database, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  ids: string[];
}

export function ClassroomImportButton() {
  const [open, setOpen] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  // Try to extract classrooms from localStorage keys
  const extractFromLocalStorage = () => {
    const classrooms: unknown[] = [];

    // Common localStorage key patterns for classrooms
    const patterns = ['classroom_', 'stage_', 'course_', 'classroom-data', 'my-courses'];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Check if key matches any pattern
      if (patterns.some((p) => key.toLowerCase().includes(p.toLowerCase()))) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const parsed = JSON.parse(value);
            // Handle both single object and array
            if (Array.isArray(parsed)) {
              classrooms.push(...parsed);
            } else {
              classrooms.push(parsed);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    if (classrooms.length > 0) {
      setJsonInput(JSON.stringify(classrooms, null, 2));
    } else {
      setError('未在浏览器存储中找到课程数据。请手动粘贴课程 JSON。');
    }
  };

  const handleImport = async () => {
    if (!jsonInput.trim()) {
      setError('请输入课程数据');
      return;
    }

    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      let data: unknown;
      try {
        data = JSON.parse(jsonInput);
      } catch {
        setError('JSON 格式无效，请检查输入');
        setIsLoading(false);
        return;
      }

      // Ensure it's an array
      const classrooms = Array.isArray(data) ? data : [data];

      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        setError('请先登录');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/classroom/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(classrooms),
      });

      const result = await response.json();

      if (result.success) {
        setResult(result.data);
      } else {
        setError(result.error || '导入失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Database className="w-4 h-4" />
        导入本地课程
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>导入课程到数据库</DialogTitle>
            <DialogDescription>
              将浏览器本地存储的课程迁移到服务器数据库
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={extractFromLocalStorage}
                className="flex-1"
                type="button"
              >
                <Upload className="w-4 h-4 mr-2" />
                从浏览器存储提取
              </Button>
            </div>

            <div className="space-y-2">
              <Label>课程数据 (JSON)</Label>
              <Textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder={`[
  {
    "id": "course-id-1",
    "name": "课程名称",
    "description": "课程描述",
    "category": "programming",
    "scenes": [...]
  }
]`}
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert className={result.errors.length === 0 ? 'bg-green-50 border-green-200' : ''}>
                <CheckCircle className={result.errors.length === 0 ? 'w-4 h-4 text-green-600' : 'w-4 h-4'} />
                <AlertDescription>
                  成功导入 {result.imported} 个课程
                  {result.errors.length > 0 && (
                    <>, 失败 {result.errors.length} 个</>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {result?.errors && result.errors.length > 0 && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
                <p className="font-medium mb-2">错误详情：</p>
                <ul className="list-disc list-inside space-y-1">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>...还有 {result.errors.length - 5} 个错误</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleImport}
              disabled={isLoading}
              className="bg-[#722ed1] hover:bg-[#722ed1]/90"
            >
              {isLoading ? '导入中...' : '开始导入'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
