'use client';

import React, { useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface SyncResult {
  scanned: number;
  imported: number;
  skipped: number;
  errors: string[];
  ids: string[];
}

interface SyncStatus {
  filesystemCount: number;
  databaseCount: number;
  syncedCount: number;
  missingCount: number;
  missingIds: string[];
}

export function ClassroomSyncButton() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState('');

  const checkStatus = async () => {
    setChecking(true);
    setError('');

    try {
      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        setError('请先登录');
        setChecking(false);
        return;
      }

      const response = await fetch('/api/classroom/sync-files', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setStatus(data.data);
      } else {
        setError(data.error || '检查失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '检查失败');
    } finally {
      setChecking(false);
    }
  };

  const handleSync = async () => {
    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        setError('请先登录');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/classroom/sync-files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
        // Refresh status after sync
        await checkStatus();
      } else {
        setError(data.error || '同步失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          checkStatus();
        }}
        className="gap-2"
      >
        <RefreshCw className="w-4 h-4" />
        同步课程
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>同步文件系统课程</DialogTitle>
            <DialogDescription>
              将文件系统中存在的课程导入到数据库
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {checking ? (
              <div className="text-center py-4">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">检查中...</p>
              </div>
            ) : status ? (
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>文件系统课程:</span>
                  <span className="font-medium">{status.filesystemCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>数据库课程:</span>
                  <span className="font-medium">{status.databaseCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>已同步:</span>
                  <span className="font-medium text-green-600">{status.syncedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>待同步:</span>
                  <span className="font-medium text-amber-600">{status.missingCount}</span>
                </div>
              </div>
            ) : null}

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
                  扫描 {result.scanned} 个文件，成功导入 {result.imported} 个课程
                </AlertDescription>
              </Alert>
            )}

            {status?.missingCount && status.missingCount > 0 ? (
              <div className="text-sm bg-amber-50 p-3 rounded border border-amber-200">
                <p className="font-medium text-amber-800 mb-2">待同步课程 ID:</p>
                <div className="flex flex-wrap gap-1">
                  {status.missingIds.slice(0, 10).map(id => (
                    <code key={id} className="text-xs bg-amber-100 px-1.5 py-0.5 rounded">
                      {id}
                    </code>
                  ))}
                  {status.missingIds.length > 10 && (
                    <span className="text-xs text-amber-700">+{status.missingIds.length - 10} 更多</span>
                  )}
                </div>
              </div>
            ) : status && !checking ? (
              <div className="text-center py-2 text-sm text-green-600">
                <CheckCircle className="w-5 h-5 inline-block mr-1" />
                所有课程已同步
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              onClick={handleSync}
              disabled={isLoading || checking || (!!status && status.missingCount === 0)}
              className="bg-[#722ed1] hover:bg-[#722ed1]/90"
            >
              {isLoading ? '同步中...' : '开始同步'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
