'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, LogOut, Settings, Sparkles, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { useSettingsDialogStore } from '@/lib/store/settings-dialog';
import { toast } from 'sonner';

export function UserNav() {
  const router = useRouter();
  const { user, logout, canGenerate, canAdmin } = useAuth();
  const { openDialog } = useSettingsDialogStore();

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('已退出登录');
      router.push('/login');
    } catch {
      toast.error('退出失败');
    }
  };

  const handleSettingsClick = () => {
    openDialog(undefined);
  };

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">登录</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/register">注册</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <User className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user.displayName || user.username}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
            <div className="flex items-center gap-1 mt-1">
              {canAdmin && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  管理员
                </span>
              )}
              {!canAdmin && canGenerate && (
                <span className="text-xs bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded">
                  生成者
                </span>
              )}
              {!canGenerate && (
                <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  观看者
                </span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin" className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              管理后台
            </Link>
          </DropdownMenuItem>
        )}
        {!canGenerate && (
          <DropdownMenuItem asChild>
            <Link href="/apply-generator" className="cursor-pointer">
              <Sparkles className="mr-2 h-4 w-4" />
              申请成为生成者
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleSettingsClick} className="cursor-pointer">
          <Settings className="mr-2 h-4 w-4" />
          设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
