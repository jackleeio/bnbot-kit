'use client';

import React, { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import { SearchedTweet, TwitterUserInfo } from '@/types/x-agent';

interface TweetCardModalProps {
    isOpen: boolean;
    onClose: () => void;
    tweet: SearchedTweet | null;
    user: TwitterUserInfo;
}

const formatNumber = (num: number): string => {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toLocaleString();
};

const formatTweetDate = (dateStr: string): string => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    // Format: 8:30 PM · Dec 25, 2025
    const time = date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    const day = date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${time} · ${day}`;
};


const MediaItem = ({ media }: { media: { type: string; url: string; thumbnail?: string } }) => {
    const [isLoading, setIsLoading] = React.useState(true);

    return (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
            {isLoading && (
                <div className="skeleton absolute inset-0 z-10 h-full w-full bg-gray-200" />
            )}
            {media.type === 'photo' ? (
                <img
                    src={media.url}
                    alt="Tweet media"
                    className={`h-full w-full object-cover transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                    onLoad={() => setIsLoading(false)}
                />
            ) : (
                <video
                    src={media.url}
                    poster={media.thumbnail}
                    controls
                    className="h-full w-full object-cover"
                    onLoadedData={() => setIsLoading(false)}
                />
            )}
        </div>
    );
};

const TweetCardModal: React.FC<TweetCardModalProps> = ({ isOpen, onClose, tweet, user }) => {
    if (!tweet) return null;

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
                </Transition.Child>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4 text-center">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="relative h-12 w-12 overflow-hidden rounded-full border border-gray-100">
                                            {user.profileImageUrl ? (
                                                <img
                                                    src={user.profileImageUrl}
                                                    alt={user.name}
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center bg-gray-200 text-xl font-bold text-gray-500">
                                                    {user.name.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1">
                                                <h3 className="text-base font-bold text-gray-900">{user.name}</h3>
                                                {user.verified && (
                                                    <svg className="h-4 w-4 text-[#1d9bf0]" viewBox="0 0 22 22" fill="currentColor">
                                                        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
                                                    </svg>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-500">@{user.username}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={onClose}
                                        className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                                    >
                                        <XMarkIcon className="h-5 w-5" />
                                    </button>
                                </div>


                                <div className="mt-4">
                                    <p className="whitespace-pre-wrap text-[17px] leading-normal text-gray-900">
                                        {tweet.content.split(/(@\w+)/g).map((part, index) => (
                                            part.match(/^@\w+$/) ? (
                                                <span key={index} className="text-[#1d9bf0] cursor-pointer hover:underline">
                                                    {part}
                                                </span>
                                            ) : (
                                                <span key={index}>{part}</span>
                                            )
                                        ))}
                                    </p>
                                </div>



                                {tweet.mediaDetails && tweet.mediaDetails.length > 0 ? (
                                    <div className={`mt-4 grid gap-1.5 overflow-hidden rounded-2xl border border-gray-100 ${tweet.mediaDetails.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                                        }`}>
                                        {tweet.mediaDetails.map((media, index) => (
                                            <MediaItem key={index} media={media} />
                                        ))}
                                    </div>
                                ) : tweet.media ? (
                                    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-center text-sm text-gray-500">
                                        [Media: {tweet.media}]
                                    </div>
                                ) : null}

                                <div className="mt-4 border-b border-gray-100 pb-4">
                                    <p className="text-sm text-gray-500 hover:underline cursor-pointer">
                                        {formatTweetDate(tweet.postedAt)}
                                    </p>
                                </div>

                                <div className="flex items-center gap-6 py-4 border-b border-gray-100">
                                    <div className="flex gap-1">
                                        <span className="font-bold text-gray-900">{formatNumber(tweet.retweets)}</span>
                                        <span className="text-gray-500">Retweets</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <span className="font-bold text-gray-900">{formatNumber(tweet.likes)}</span>
                                        <span className="text-gray-500">Likes</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <span className="font-bold text-gray-900">{formatNumber(tweet.replies)}</span>
                                        <span className="text-gray-500">Replies</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <span className="font-bold text-gray-900">{formatNumber(tweet.impressions)}</span>
                                        <span className="text-gray-500">Views</span>
                                    </div>
                                </div>

                                <div className="mt-4 flex justify-between">
                                    <a
                                        href={tweet.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                                    >
                                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                        View on X
                                    </a>

                                    <button className="inline-flex items-center gap-2 rounded-full border border-transparent bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800">
                                        <SparklesIcon className="h-4 w-4" />
                                        Generate similar
                                    </button>
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
};

export default TweetCardModal;
