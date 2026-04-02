'use client';

import { useModal } from '@/components/modal-views/context';
import AuthorInformation from '@/components/author/author-information';
import { authorData } from '@/data/static/author';
import ProfileTab from '@/components/profile/profile-tab';
import { DotsIcon } from '@/components/icons/dots-icon';
import { XIcon } from '@/components/icons/x-icon';
// dummy data
import User1 from '@/assets/images/avatar/8.jpg';
import User2 from '@/assets/images/avatar/9.jpg';
import User3 from '@/assets/images/avatar/10.jpg';
import User4 from '@/assets/images/avatar/11.jpg';
import User5 from '@/assets/images/collection/collection-1.jpg';
import User6 from '@/assets/images/collection/collection-2.jpg';
import User7 from '@/assets/images/collection/collection-3.jpg';
import User8 from '@/assets/images/collection/collection-4.jpg';
import User9 from '@/assets/images/collection/collection-5.jpg';
import User10 from '@/assets/images/collection/collection-6.jpg';
import { useCopyToClipboard } from 'react-use';
import { useState } from 'react';
import { Check } from '@/components/icons/check';
import { Copy } from '@/components/icons/copy';

const data = [
  { name: 'Amanda Jones', thumbnail: User1 },
  { name: 'Marcos Llanos', thumbnail: User2 },
  { name: 'Garry Heffernan', thumbnail: User3 },
  { name: 'Teresa J. Brown', thumbnail: User4 },
  { name: 'Williams Sarah', thumbnail: User5 },
  { name: 'Teresa W. Luter', thumbnail: User6 },
  { name: 'Dorothy Pacheco', thumbnail: User7 },
  { name: 'Christopher', thumbnail: User8 },
  { name: 'Ted Luster', thumbnail: User4 },
  { name: 'R. Foster', thumbnail: User9 },
  { name: 'Domingo', thumbnail: User3 },
  { name: 'Conway', thumbnail: User10 },
];

export default function RetroProfile() {
  const [copyButtonStatus, setCopyButtonStatus] = useState(false);
  const [_, copyToClipboard] = useCopyToClipboard();
  function handleCopyToClipboard() {
    copyToClipboard(authorData.wallet_key);
    setCopyButtonStatus(true);
    setTimeout(() => {
      setCopyButtonStatus(copyButtonStatus);
    }, 2500);
  }
  const { openModal } = useModal();
  return (
    <div className="w-full pt-3">
      <div className="flex w-full flex-col items-center md:flex-row">
        <div className="text-center ltr:md:text-left rtl:md:text-right">
          <h2 className="text-xl font-medium tracking-tighter text-gray-900 dark:text-white xl:text-2xl">
            Jack Lee
          </h2>
          {/* <div className="mt-1 text-sm font-medium tracking-tighter text-gray-600 dark:text-gray-400 xl:mt-3">
            @{authorData?.user_name}
          </div> */}
        </div>
        <div className="mt-5 flex md:mt-0 ltr:md:ml-auto rtl:md:mr-auto">
          <a
            className="cursor-pointer rounded-full text-gray-500 transition hover:bg-slate-100 dark:hover:text-white"
            href={'https://x.com/jackleeio'}
          >
            <div className="rounded-full p-2.5">
              <XIcon className="relative h-5 w-5" />
            </div>
          </a>
        </div>
      </div>
      <div className="mt-3 flex h-9 w-full items-center rounded-full bg-white shadow-card dark:bg-light-dark">
        <div className="flex h-full shrink-0 grow-0 items-center rounded-full bg-gray-900 px-4 text-xs text-white sm:text-sm">
          @jackleeio
        </div>
        <div className="text truncate text-ellipsis bg-center text-xs text-gray-500 dark:text-gray-300 sm:text-sm ltr:pl-4 rtl:pr-4">
          {authorData?.wallet_key}
        </div>
        <div
          className="flex cursor-pointer items-center px-4 text-gray-500 transition hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          title="Copy Address"
          onClick={() => handleCopyToClipboard()}
        >
          {copyButtonStatus ? (
            <Check className="h-auto w-3.5 text-green-500" />
          ) : (
            <Copy className="h-auto w-3.5" />
          )}
        </div>
      </div>
      <div className="grow pb-9 pt-6 md:pb-0">
        <ProfileTab />
      </div>
      {/* <AuthorInformation data={authorData} /> */}
    </div>
  );
}
