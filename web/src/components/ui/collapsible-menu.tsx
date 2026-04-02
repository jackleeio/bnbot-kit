'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import cn from '@/utils/cn';
import { motion } from 'framer-motion';
import { useMeasure } from '@/lib/hooks/use-measure';
import ActiveLink from '@/components/ui/links/active-link';
import { ChevronDown } from '@/components/icons/chevron-down';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type MenuItemProps = {
  name?: string;
  icon: React.ReactNode;
  href: string;
  dropdownItems?: DropdownItemProps[];
  isActive?: boolean;
  isCollapsed?: boolean;
};

type DropdownItemProps = {
  name: string;
  href: string;
};

export function MenuItem({
  name,
  icon,
  href,
  dropdownItems,
  isActive,
  isCollapsed,
}: MenuItemProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [ref, { height }] = useMeasure<HTMLUListElement>();
  const isChildrenActive =
    dropdownItems && dropdownItems.some((item) => item.href === pathname);
  useEffect(() => {
    if (isChildrenActive) {
      setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mb-2 min-h-[48px] list-none last:mb-0">
      {dropdownItems?.length ? (
        <>
          <div
            className={cn(
              'relative flex h-12 cursor-pointer items-center justify-between whitespace-nowrap  rounded-lg px-4 text-sm transition-all',
              isChildrenActive
                ? 'text-white'
                : 'text-gray-500 hover:text-brand dark:hover:text-white',
            )}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="z-[1] flex items-center ltr:mr-3 rtl:ml-3">
              {/* <span className={cn('ltr:mr-3 rtl:ml-3')}>{icon}</span> */}
              {name}
            </span>
            <span
              className={`z-[1] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
                }`}
            >
              <ChevronDown />
            </span>

            {isChildrenActive && (
              <motion.span
                className={cn(
                  'absolute bottom-0 left-0 right-0 h-full w-full rounded-lg bg-brand opacity-0 shadow-large transition-opacity',
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              />
            )}
          </div>

          <div
            style={{
              height: isOpen ? height : 0,
            }}
            className="ease-[cubic-bezier(0.33, 1, 0.68, 1)] overflow-hidden transition-all duration-350"
          >
            <ul ref={ref}>
              {dropdownItems.map((item, index) => (
                <li className="first:pt-2" key={index}>
                  <ActiveLink
                    href={item.href}
                    className="flex items-center rounded-lg p-3 text-sm text-gray-500 transition-all before:h-1 before:w-1 before:rounded-full before:bg-gray-500 hover:text-brand dark:hover:text-white ltr:pl-6 before:ltr:mr-5 rtl:pr-6 before:rtl:ml-5"
                    activeClassName="!text-brand dark:!text-white dark:before:!bg-white before:!bg-brand before:!w-2 before:!h-2 before:-ml-0.5 before:ltr:!mr-[18px] before:rtl:!ml-[18px] !font-medium"
                  >
                    {item.name}
                  </ActiveLink>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : href.startsWith('http') ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'font-bolder relative flex h-8 items-center whitespace-nowrap rounded-3xl rounded-none px-1.5 text-xs text-gray-500 transition-all hover:text-gray-700'
          )}
        >
          {/* 图标 - 固定在左边位置，永远不动 */}
          {icon && (
            <div className="absolute left-2 top-[47%] z-[2] flex items-center justify-center -translate-y-1/2 w-4 h-4">
              {icon}
            </div>
          )}
          {/* 文字容器 - 左边留出图标空间 */}
          {name && (
            <span className="relative z-[1] pl-8" suppressHydrationWarning>
              {name}
            </span>
          )}
        </a>
      ) : (href === '/boost' || href === '/xInsight' || href === '/plugin') ? (
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'font-bolder relative flex h-8 items-center whitespace-nowrap rounded-3xl rounded-none px-1.5 text-xs text-gray-500 transition-all hover:text-gray-700 cursor-not-allowed group w-fit'
                )}
                onClick={(e) => e.preventDefault()}
              >
                {/* 图标 - 固定在左边位置，永远不动 */}
                {icon && (
                  <div className="absolute left-2 top-[47%] z-[2] flex items-center justify-center -translate-y-1/2 w-4 h-4">
                    {icon}
                  </div>
                )}
                {/* 文字容器 - 左边留出图标空间 */}
                {name && (
                  <span className="relative z-[1] pl-8" suppressHydrationWarning>
                    {name}
                  </span>
                )}
                {/* Coming Soon 标签 - 收起时隐藏 */}
                {!isCollapsed && (
                  <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium text-[#f0b90b] bg-[#f0b90b]/10 rounded">
                    Soon
                  </span>
                )}
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right" sideOffset={20} className="hidden md:block z-[100]">
                <p>Coming Soon</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      ) : (
        <ActiveLink
          href={href}
          className={cn(
            'font-bolder relative flex h-8 items-center whitespace-nowrap rounded-3xl rounded-none px-1.5 text-xs text-gray-500 transition-all hover:text-gray-700'
          )}
          activeClassName="!text-black"
        >
          {/* 图标 - 固定在左边位置，永远不动 */}
          {icon && (
            <div className="absolute left-2 top-[47%] z-[2] flex items-center justify-center -translate-y-1/2 w-4 h-4">
              {icon}
            </div>
          )}
          {/* 文字容器 - 左边留出图标空间 */}
          {name && (
            <span className="relative z-[1] pl-8" suppressHydrationWarning>
              {name}
            </span>
          )}

          {/* 移除选中状态的背景色显示 */}
        </ActiveLink>
      )}
    </div>
  );
}
