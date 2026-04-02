'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  UserCog,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Shield,
  GraduationCap,
  Eye,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { User, UserRole, UserStatus } from '@/lib/types/user';

interface UserStats {
  total: number;
  active: number;
  pending: number;
  inactive: number;
  byRole: Record<UserRole, number>;
}

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Action dialogs
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: 'approve' | 'reject' | 'freeze' | 'unfreeze' | 'role' | null;
    user: User | null;
  }>({ open: false, type: null, user: null });
  const [actionReason, setActionReason] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('viewer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', currentPage.toString());
      params.set('limit', '20');

      const response = await fetch(`/api/admin/users?${params}`);
      const result = await response.json();

      if (result.success) {
        setUsers(result.users || []);
        setTotalPages(result.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error('Fetch users error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter, currentPage]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users/stats');
      const result = await response.json();
      if (result.success) {
        setStats(result.stats || result.data || null);
      }
    } catch (error) {
      console.error('Fetch stats error:', error);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchStats();
  }, [fetchUsers, fetchStats]);

  const handleAction = async () => {
    if (!actionDialog.user || !actionDialog.type) return;

    setIsSubmitting(true);
    try {
      let response;

      if (actionDialog.type === 'role') {
        response = await fetch(`/api/admin/users/${actionDialog.user.id}/role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole, reason: actionReason }),
        });
      } else {
        const actionMap: Record<string, string> = {
          approve: 'approve',
          reject: 'reject',
          freeze: 'freeze',
          unfreeze: 'unfreeze',
        };

        response = await fetch(
          `/api/admin/users?id=${actionDialog.user.id}&action=${actionMap[actionDialog.type]}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: actionReason }),
          }
        );
      }

      const result = await response.json();

      if (result.success) {
        setActionDialog({ open: false, type: null, user: null });
        setActionReason('');
        fetchUsers();
        fetchStats();
      } else {
        alert(result.error?.message || '操作失败');
      }
    } catch (error) {
      alert('操作失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openActionDialog = (type: typeof actionDialog.type, user: User) => {
    setActionDialog({ open: true, type, user });
    setActionReason('');
    if (type === 'role') {
      setNewRole(user.role);
    }
  };

  const getStatusBadge = (status: UserStatus) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
            <CheckCircle className="w-3 h-3 mr-1" />
            正常
          </Badge>
        );
      case 'pending_approval':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
            <AlertCircle className="w-3 h-3 mr-1" />
            待审批
          </Badge>
        );
      case 'inactive':
        return (
          <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20">
            <XCircle className="w-3 h-3 mr-1" />
            已冻结
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-gray-500/10 text-gray-600 hover:bg-gray-500/20">
            <XCircle className="w-3 h-3 mr-1" />
            已拒绝
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return (
          <Badge className="bg-purple-500/10 text-purple-600 hover:bg-purple-500/20">
            <Shield className="w-3 h-3 mr-1" />
            管理员
          </Badge>
        );
      case 'generator':
        return (
          <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">
            <GraduationCap className="w-3 h-3 mr-1" />
            生产者
          </Badge>
        );
      case 'viewer':
        return (
          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
            <Eye className="w-3 h-3 mr-1" />
            学习者
          </Badge>
        );
      default:
        return <Badge>{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                总用户数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                待审批
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                正常用户
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                生产者
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.byRole.generator}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索用户名、邮箱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | 'all')}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="角色筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
            <SelectItem value="generator">生产者</SelectItem>
            <SelectItem value="viewer">学习者</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UserStatus | 'all')}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="状态筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">正常</SelectItem>
            <SelectItem value="pending_approval">待审批</SelectItem>
            <SelectItem value="inactive">已冻结</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>用户列表</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#722ed1]" />
              <span className="ml-2 text-muted-foreground">加载中...</span>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-6 px-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户名</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="hidden sm:table-cell">注册时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{user.username}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {user.status === 'pending_approval' && (
                                <>
                                  <DropdownMenuItem onClick={() => openActionDialog('approve', user)}>
                                    <UserCheck className="w-4 h-4 mr-2 text-green-600" />
                                    审批通过
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openActionDialog('reject', user)}>
                                    <UserX className="w-4 h-4 mr-2 text-red-600" />
                                    拒绝申请
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {user.status === 'active' && (
                                <DropdownMenuItem onClick={() => openActionDialog('freeze', user)}>
                                  <UserX className="w-4 h-4 mr-2 text-amber-600" />
                                  冻结账户
                                </DropdownMenuItem>
                              )}
                              {user.status === 'inactive' && (
                                <DropdownMenuItem onClick={() => openActionDialog('unfreeze', user)}>
                                  <UserCheck className="w-4 h-4 mr-2 text-green-600" />
                                  解冻账户
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openActionDialog('role', user)}>
                                <UserCog className="w-4 h-4 mr-2 text-blue-600" />
                                变更角色
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  共 {users.length} 条记录
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    第 {currentPage} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog
        open={actionDialog.open}
        onOpenChange={(open) => !open && setActionDialog({ open: false, type: null, user: null })}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === 'approve' && '审批通过'}
              {actionDialog.type === 'reject' && '拒绝申请'}
              {actionDialog.type === 'freeze' && '冻结账户'}
              {actionDialog.type === 'unfreeze' && '解冻账户'}
              {actionDialog.type === 'role' && '变更角色'}
            </DialogTitle>
            <DialogDescription>
              操作对象：{actionDialog.user?.username}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {actionDialog.type === 'role' && (
              <div className="space-y-2">
                <Label>新角色</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理员</SelectItem>
                    <SelectItem value="generator">生产者</SelectItem>
                    <SelectItem value="viewer">学习者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {actionDialog.type !== 'unfreeze' && actionDialog.type !== 'approve' && (
              <div className="space-y-2">
                <Label>原因（可选）</Label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="请输入操作原因..."
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialog({ open: false, type: null, user: null })}
            >
              取消
            </Button>
            <Button
              onClick={handleAction}
              disabled={isSubmitting}
              variant={actionDialog.type === 'freeze' || actionDialog.type === 'reject' ? 'destructive' : 'default'}
              className={
                actionDialog.type !== 'freeze' && actionDialog.type !== 'reject'
                  ? 'bg-[#722ed1] hover:bg-[#722ed1]/90'
                  : ''
              }
            >
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
