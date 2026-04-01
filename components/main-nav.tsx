'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Home, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserNav } from './user-nav';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';

const navigation = [
  { name: '首页', href: '/', icon: Home },
  { name: '课程', href: '/classrooms', icon: BookOpen },
];

export function MainNav() {
  const pathname = usePathname();
  const { isAuthenticated, canGenerate } = useAuth();

  // Hide navigation on auth pages
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (isAuthPage) {
    return (
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Link href="/" className="flex items-center space-x-2">
            <BookOpen className="h-6 w-6" />
            <span className="font-bold">OpenMAIC</span>
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <BookOpen className="h-6 w-6" />
            <span className="font-bold">OpenMAIC</span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'transition-colors hover:text-foreground/80',
                  pathname === item.href ? 'text-foreground' : 'text-foreground/60'
                )}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-2">
          <UserNav />
        </div>
      </div>
    </header>
  );
}
