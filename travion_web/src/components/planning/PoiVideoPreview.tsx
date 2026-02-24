import React from 'react';

export interface PoiVideo {
  poiName: string;
  videoId: string;
  url: string;
  thumbnail: string;
  title: string;
  channel: string;
  durationLabel: string;
  views: number;
  publishedLabel: string;
}

interface Props {
  video: PoiVideo;
}

function formatViews(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

const PoiVideoPreview: React.FC<Props> = ({ video }) => {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 mt-2 p-2 rounded-lg bg-black/30 border border-white/10 hover:border-purple-400/50 hover:bg-black/50 transition-all group no-underline"
    >
      {/* Thumbnail */}
      <div className="relative flex-shrink-0 w-20 h-14 rounded-md overflow-hidden">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover"
        />
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-colors">
          <svg
            className="w-6 h-6 text-white drop-shadow"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        {/* Duration badge */}
        <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded">
          {video.durationLabel}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white/90 leading-snug line-clamp-2 group-hover:text-purple-300 transition-colors">
          {video.title}
        </p>
        <p className="text-[10px] text-white/50 mt-0.5 truncate">
          {video.channel} &bull; {formatViews(video.views)} views &bull; {video.publishedLabel}
        </p>
      </div>

      {/* External link icon */}
      <svg
        className="w-3.5 h-3.5 text-white/30 flex-shrink-0 group-hover:text-purple-400 transition-colors"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
};

export default PoiVideoPreview;
