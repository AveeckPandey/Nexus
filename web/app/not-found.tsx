'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="h-[100dvh] w-full bg-[#E0E5EC] text-[#2F343D] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[460px] bg-[#E0E5EC] rounded-[24px] p-8 shadow-[16px_16px_40px_#babecc,-16px_-16px_40px_#ffffff] text-center flex flex-col items-center">
        
        {/* Brand Mark */}
        <div className="w-14 h-14 rounded-2xl bg-[#E0E5EC] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] flex items-center justify-center mb-4">
          <img src="/nexus-alien.png" alt="Nexus" className="w-8 h-8 object-contain" />
        </div>

        {/* 404 Badge */}
        <span className="font-mono text-[12px] font-extrabold tracking-[0.2em] text-[#CC5500] bg-[#E0E5EC] rounded-full px-4 py-1.5 shadow-[inset_3px_3px_6px_#b8bcc9,inset_-3px_-3px_6px_#ffffff] mb-3">
          404 ERROR
        </span>

        <h1 className="text-[26px] font-black tracking-tight text-[#2F343D] leading-tight">
          Page Not Found
        </h1>
        <p className="text-[13px] font-medium text-[#8A8F98] mt-2 max-w-[320px]">
          The conversation or page you are looking for has expired, self-destructed, or does not exist.
        </p>

        {/* Return Button */}
        <Link
          href="/"
          className="mt-6 w-full bg-[#CC5500] rounded-xl px-5 py-3 font-bold text-[14px] text-white tracking-tight shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:bg-[#B34A00] active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.35)] transition-all block text-center"
        >
          Return to Nexus Chat &rarr;
        </Link>
      </div>
    </div>
  );
}
