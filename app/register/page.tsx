'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/lib/auth/auth-context';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    role: 'viewer' as 'generator' | 'viewer',
  });

  // Availability check states
  const [availability, setAvailability] = useState({
    username: { checking: false, available: null as boolean | null, message: '' },
    email: { checking: false, available: null as boolean | null, message: '' },
  });

  const usernameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check username availability
  const checkUsername = useCallback(async (username: string) => {
    if (!username || username.length < 3) return;
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      setAvailability(prev => ({
        ...prev,
        username: { checking: false, available: false, message: '用户名格式不正确' }
      }));
      return;
    }

    setAvailability(prev => ({ ...prev, username: { ...prev.username, checking: true } }));

    try {
      const response = await fetch(`/api/auth/check-availability?type=username&value=${encodeURIComponent(username)}`);
      const data = await response.json();
      setAvailability(prev => ({
        ...prev,
        username: { checking: false, available: data.available, message: data.message }
      }));
    } catch {
      setAvailability(prev => ({
        ...prev,
        username: { checking: false, available: null, message: '' }
      }));
    }
  }, []);

  // Check email availability
  const checkEmail = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) return;

    setAvailability(prev => ({ ...prev, email: { ...prev.email, checking: true } }));

    try {
      const response = await fetch(`/api/auth/check-availability?type=email&value=${encodeURIComponent(email)}`);
      const data = await response.json();
      setAvailability(prev => ({
        ...prev,
        email: { checking: false, available: data.available, message: data.message }
      }));
    } catch {
      setAvailability(prev => ({
        ...prev,
        email: { checking: false, available: null, message: '' }
      }));
    }
  }, []);

  // Debounced check handlers
  useEffect(() => {
    if (usernameTimeoutRef.current) clearTimeout(usernameTimeoutRef.current);
    if (formData.username.length >= 3) {
      usernameTimeoutRef.current = setTimeout(() => checkUsername(formData.username), 500);
    }
    return () => {
      if (usernameTimeoutRef.current) clearTimeout(usernameTimeoutRef.current);
    };
  }, [formData.username, checkUsername]);

  useEffect(() => {
    if (emailTimeoutRef.current) clearTimeout(emailTimeoutRef.current);
    if (formData.email.includes('@')) {
      emailTimeoutRef.current = setTimeout(() => checkEmail(formData.email), 500);
    }
    return () => {
      if (emailTimeoutRef.current) clearTimeout(emailTimeoutRef.current);
    };
  }, [formData.email, checkEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('密码至少需要6个字符');
      setIsLoading(false);
      return;
    }

    // 验证用户名格式
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(formData.username)) {
      setError('用户名必须是3-32位字母、数字、下划线或横线');
      setIsLoading(false);
      return;
    }

    // 检查用户名和邮箱是否可用
    if (availability.username.available === false) {
      setError('用户名已被使用');
      setIsLoading(false);
      return;
    }
    if (availability.email.available === false) {
      setError('邮箱已被注册');
      setIsLoading(false);
      return;
    }

    try {
      await register(
        formData.username,
        formData.email,
        formData.password,
        formData.displayName || formData.username,
        formData.role
      );
      toast.success('注册申请已提交，请等待管理员审批');
      router.push('/login?pending=true');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">注册 OpenMAIC</CardTitle>
          <CardDescription className="text-center">
            创建新账号以开始使用
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <div className="relative">
                <Input
                  id="username"
                  type="text"
                  placeholder="3-32位字母、数字、下划线或横线"
                  value={formData.username}
                  onChange={(e) => {
                    setFormData({ ...formData, username: e.target.value });
                    if (e.target.value.length < 3) {
                      setAvailability(prev => ({ ...prev, username: { checking: false, available: null, message: '' } }));
                    }
                  }}
                  required
                  disabled={isLoading}
                  className={cn(
                    availability.username.available === true && 'border-green-500 focus-visible:ring-green-500',
                    availability.username.available === false && 'border-red-500 focus-visible:ring-red-500'
                  )}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {availability.username.checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {!availability.username.checking && availability.username.available === true && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {!availability.username.checking && availability.username.available === false && (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              </div>
              {availability.username.message && (
                <p className={cn('text-xs', availability.username.available ? 'text-green-600' : 'text-red-600')}>
                  {availability.username.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">显示名称（可选）</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="您的显示名称"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value });
                    if (!e.target.value.includes('@')) {
                      setAvailability(prev => ({ ...prev, email: { checking: false, available: null, message: '' } }));
                    }
                  }}
                  required
                  disabled={isLoading}
                  className={cn(
                    availability.email.available === true && 'border-green-500 focus-visible:ring-green-500',
                    availability.email.available === false && 'border-red-500 focus-visible:ring-red-500'
                  )}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {availability.email.checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {!availability.email.checking && availability.email.available === true && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {!availability.email.checking && availability.email.available === false && (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              </div>
              {availability.email.message && (
                <p className={cn('text-xs', availability.email.available ? 'text-green-600' : 'text-red-600')}>
                  {availability.email.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少6个字符"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="再次输入密码"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-3">
              <Label>注册身份</Label>
              <RadioGroup
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as 'generator' | 'viewer' })}
                className="grid grid-cols-2 gap-4"
              >
                <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="generator" id="generator" />
                  <Label htmlFor="generator" className="cursor-pointer flex-1">
                    <div className="font-medium">教师 / 创作者</div>
                    <div className="text-xs text-muted-foreground">可创建和发布课程</div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="viewer" id="viewer" />
                  <Label htmlFor="viewer" className="cursor-pointer flex-1">
                    <div className="font-medium">学生 / 学习者</div>
                    <div className="text-xs text-muted-foreground">可浏览和学习课程</div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || availability.username.available === false || availability.email.available === false}
            >
              {isLoading ? '提交中...' : '提交注册申请'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-muted-foreground">
            已有账号？{' '}
            <Link href="/login" className="text-primary hover:underline">
              立即登录
            </Link>
          </div>
          <div className="text-xs text-center text-muted-foreground">
            注册后需等待管理员审批通过后方可使用
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
