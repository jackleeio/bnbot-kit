interface Tweet {
  id: string;
  text: string;
  created_at: string;
  media: {
    type: string;
    media_url_https: string;
    video_info?: {
      variants: {
        url: string;
        content_type: string;
        bitrate?: number;
      }[];
    };
  }[];
  author: {
    name: string;
    screen_name: string;
    profile_image: string;
    followers_count: number;
  };
  stats: {
    retweets: number;
    likes: number;
    replies: number;
    views_count: number;
    quote_count: number;
    holders_count?: number;
  };
  price?: {
    amount: number;
    currency: string;
    market_cap?: number;
  };
}
const MOCK_TWEETS: Tweet[] = [
  {
    id: '1859694666721133032',
    text: 'Just livin’ the meme 🔥🔥🔥',
    created_at: 'Thu Nov 21 20:25:34 +0000 2024',
    media: [
      {
        type: 'image',
        media_url_https:
          'https://pbs.twimg.com/media/GUf8-FpW4AADxl2?format=jpg&name=medium',
      },
    ],
    author: {
      name: 'Elon Musk',
      screen_name: 'elonmusk',
      profile_image:
        'https://pbs.twimg.com/profile_images/1417930292464132104/alsNDF19_normal.jpg',
      followers_count: 170200000,
    },
    stats: {
      retweets: 157,
      likes: 1048,
      replies: 71,
      views_count: 177059,
      quote_count: 18,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 2000000,
    },
  },
  {
    id: '1859687102050603279',
    text: 'We really got Snoop Dogg & Dr. Dre rapping back and forth in 2024, this year is crazy man 😭',
    created_at: 'Thu Nov 21 19:55:31 +0000 2024',
    media: [
      {
        type: 'image',
        media_url_https:
          'https://pump.mypinata.cloud/ipfs/QmQ2CbZarXNEeH4ter8mSWQxnd8nc29JnWrurjwHfMntqB?img-width=800&img-dpr=2&img-onerror=redirect',
      },
    ],
    author: {
      name: 'Jah Talks Music',
      screen_name: 'JahTalksMusic',
      profile_image:
        'https://pbs.twimg.com/profile_images/1423683204477853712/Osvagypn_normal.jpg',
      followers_count: 125000,
    },
    stats: {
      retweets: 99,
      likes: 1007,
      replies: 45,
      views_count: 143219,
      quote_count: 5,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 1500000,
    },
  },
  {
    id: '1859656568591220796',
    text: "Dr. Dre and Snoop Dogg performing 'Still D.R.E.' at the Fortnite Festival 🎮🎵",
    created_at: 'Thu Nov 21 17:54:10 +0000 2024',
    media: [
      {
        type: 'video',
        media_url_https:
          'https://pbs.twimg.com/ext_tw_video_thumb/1859656526161379328/pu/img/67ZW2cR7YjWTPyRr.jpg',
        video_info: {
          variants: [
            {
              url: 'https://video.twimg.com/ext_tw_video/1859656526161379328/pu/vid/avc1/720x1280/9oAr-wF-90CVGp5C.mp4?tag=12',
              content_type: 'video/mp4',
              bitrate: 2176000,
            },
          ],
        },
      },
    ],
    author: {
      name: 'Dr. Dre Radar',
      screen_name: 'dreradar_',
      profile_image:
        'https://pbs.twimg.com/profile_images/1740165934659096576/FueAghB3_normal.jpg',
      followers_count: 85000,
    },
    stats: {
      retweets: 35,
      likes: 536,
      replies: 37,
      views_count: 85140,
      quote_count: 0,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 2500000,
    },
  },
  {
    id: '1859688866472734896',
    text: 'The Next Episode performance at Fortnite Festival was legendary! 🎮🎵 @SnoopDogg @drdre',
    created_at: 'Thu Nov 21 20:02:31 +0000 2024',
    media: [
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/media/Gc7xHXoXEAAK0d4.jpg',
        video_info: {
          variants: [
            {
              url: 'https://video.twimg.com/amplify_video/1859688805080383488/vid/avc1/720x1280/0BDq484XrjV9mO--.mp4?tag=16',
              content_type: 'video/mp4',
              bitrate: 2176000,
            },
          ],
        },
      },
    ],
    author: {
      name: 'Gaming Vibes',
      screen_name: 'GamingVibes',
      profile_image:
        'https://pbs.twimg.com/profile_images/1423683204477853712/Osvagypn_normal.jpg',
      followers_count: 230000,
    },
    stats: {
      retweets: 144,
      likes: 1048,
      replies: 71,
      views_count: 177059,
      quote_count: 18,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 3000000,
    },
  },
  {
    id: '1859936847111885287',
    text: 'CLIX REACTION TO THE FORTNITE LIVE EVENT SNOOP DOG CONCERT 🔥',
    created_at: 'Thu Nov 21 19:09:28 +0000 2024',
    media: [
      {
        type: 'video',
        media_url_https:
          'https://pbs.twimg.com/ext_tw_video_thumb/1862936625489084416/pu/img/FtJa7eKOFqUSf6Pn.jpg',
        video_info: {
          variants: [
            {
              url: 'https://video.twimg.com/ext_tw_video/1862936625489084416/pu/vid/avc1/1280x720/m3AIGwZebSs4D9Zn.mp4?tag=12',
              content_type: 'video/mp4',
              bitrate: 2176000,
            },
          ],
        },
      },
    ],
    author: {
      name: 'Rebuble',
      screen_name: 'Rebuble',
      profile_image:
        'https://pbs.twimg.com/profile_images/1811992167017074690/Uqgsq9si_normal.jpg',
      followers_count: 45000,
    },
    stats: {
      retweets: 35,
      likes: 536,
      replies: 37,
      views_count: 85140,
      quote_count: 0,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 4000000,
    },
  },
  {
    id: '1859694637662994788',
    text: "Epic collab! Dr. Dre x Snoop Dogg x Sting - 'Another Part of Me' dropping soon! 🎵",
    created_at: 'Thu Nov 21 20:25:27 +0000 2024',
    media: [
      {
        type: 'image',
        media_url_https: 'https://pbs.twimg.com/media/Gc7xHXoXEAAK0d4.jpg',
      },
    ],
    author: {
      name: 'Music News',
      screen_name: 'MusicNews',
      profile_image:
        'https://pbs.twimg.com/profile_images/1740165934659096576/FueAghB3_normal.jpg',
      followers_count: 520000,
    },
    stats: {
      retweets: 114,
      likes: 832,
      replies: 45,
      views_count: 143219,
      quote_count: 5,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 4500000,
    },
  },
  {
    id: '1859937006923280683',
    text: "Behind the scenes footage of Dr. Dre and Snoop recording 'Another Part of Me' 🎥🎵",
    created_at: 'Thu Nov 21 19:09:28 +0000 2024',
    media: [
      {
        type: 'image',
        media_url_https:
          'https://pump.mypinata.cloud/ipfs/QmbJoytnvEkD9RuXoZwnhBNeXFsS99nCaepwH2mQyE3TmH?img-width=800&img-dpr=2&img-onerror=redirect',
      },
    ],
    author: {
      name: 'Studio Vibes',
      screen_name: 'StudioVibes',
      profile_image:
        'https://pbs.twimg.com/profile_images/1423683204477853712/Osvagypn_normal.jpg',
      followers_count: 180000,
    },
    stats: {
      retweets: 26,
      likes: 536,
      replies: 37,
      views_count: 90140,
      quote_count: 0,
      holders_count: 1500,
    },
    price: {
      amount: 0.5,
      currency: 'ETH',
      market_cap: 5000000,
    },
  },
];



export default MOCK_TWEETS;