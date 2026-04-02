'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth/auth-context';
import { toast } from 'sonner';
import { Info } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });

  // Check for pending approval redirect
  useEffect(() => {
    if (searchParams.get('pending') === 'true') {
      setInfoMessage('注册申请已提交，请等待管理员审批通过后再登录');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setInfoMessage('');

    try {
      console.log('开始登录...', formData.username);
      await login(formData.username, formData.password);
      console.log('登录成功，准备跳转...');
      toast.success('登录成功');

      // 使用 window.location 进行硬跳转，确保中间件能检测到 cookie
      console.log('执行跳转到 /');
      window.location.href = '/';
    } catch (err) {
      console.error('登录失败:', err);
      const errorMessage = err instanceof Error ? err.message : '登录失败';

      // Handle specific error messages from API
      if (errorMessage.includes('等待管理员审批') || errorMessage.includes('PENDING_APPROVAL')) {
        setInfoMessage('您的账号正在等待管理员审批，请耐心等待');
      } else if (errorMessage.includes('已被拒绝') || errorMessage.includes('ACCOUNT_REJECTED')) {
        setError('您的注册申请已被拒绝，如有疑问请联系管理员');
      } else if (errorMessage.includes('已被冻结') || errorMessage.includes('ACCOUNT_FROZEN')) {
        setError('您的账号已被冻结，请联系管理员');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">登录 OpenMAIC</CardTitle>
          <CardDescription className="text-center">
            输入您的账号信息以继续
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {infoMessage && (
              <Alert className="bg-blue-50 border-blue-200">
                <Info className="h-4 w-4 text-blue-500" />
                <AlertDescription className="text-blue-700">{infoMessage}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">用户名或邮箱</Label>
              <Input
                id="username"
                type="text"
                placeholder="输入用户名或邮箱"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="输入密码"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-center text-muted-foreground">
            还没有账号？{' '}
            <Link href="/register" className="text-primary hover:underline">
              立即注册
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

// Wrap component with Suspense for useSearchParams
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">登录 OpenMAIC</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
