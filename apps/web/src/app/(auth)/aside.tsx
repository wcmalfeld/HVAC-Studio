/**
 * The right half of the auth screens: a quiet plan drawing with a live-looking
 * room readout. It shows what the product does instead of describing it.
 */
export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#0f2a33] text-white lg:flex lg:flex-col">
      <div className="blueprint-grid absolute inset-0" aria-hidden />
      <div className="relative flex flex-1 items-center justify-center p-12">
        <svg viewBox="0 0 520 380" className="w-full max-w-[560px]" aria-hidden>
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
            </pattern>
          </defs>
          {/* rooms */}
          <rect x="40" y="40" width="250" height="180" fill="rgba(47,179,189,0.16)" />
          <rect x="290" y="40" width="190" height="120" fill="rgba(240,122,92,0.12)" />
          <rect x="290" y="160" width="190" height="180" fill="rgba(107,156,240,0.12)" />
          <rect x="40" y="220" width="250" height="120" fill="rgba(255,255,255,0.04)" />
          {/* walls */}
          <g stroke="#e8f1f3" strokeWidth="7" strokeLinecap="square" fill="none">
            <path d="M40 40H480V340H40Z" />
          </g>
          <g stroke="#b9cbd1" strokeWidth="4" fill="none">
            <path d="M290 40V118M290 158V340M290 160H480M40 220H200M240 220H290" />
          </g>
          {/* windows */}
          <g stroke="#6b9cf0" strokeWidth="3">
            <path d="M100 40H190M360 40H430M480 210H480" />
            <path d="M480 220V290M40 100V170" />
          </g>
          <g stroke="#0f2a33" strokeWidth="1.5">
            <path d="M100 40H190M360 40H430M480 220V290M40 100V170" />
          </g>
          {/* door swing */}
          <path d="M200 220 A40 40 0 0 1 240 260" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" fill="none" />
          <path d="M200 220V260" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
          {/* dimension */}
          <g stroke="rgba(255,255,255,0.5)" strokeWidth="1" fill="none">
            <path d="M40 18H290M40 12V24M290 12V24" />
          </g>
          <text x="165" y="13" fill="rgba(255,255,255,0.75)" fontSize="11" textAnchor="middle" fontFamily="Inter Variable, Inter, sans-serif">
            20&apos; 10&quot;
          </text>
          {/* labels */}
          <g fontFamily="Inter Variable, Inter, sans-serif" textAnchor="middle">
            <text x="165" y="126" fill="#ffffff" fontSize="13" fontWeight="600">Living</text>
            <text x="165" y="143" fill="rgba(255,255,255,0.6)" fontSize="11">312 ft²</text>
            <text x="385" y="96" fill="#ffffff" fontSize="13" fontWeight="600">Kitchen</text>
            <text x="385" y="113" fill="rgba(255,255,255,0.6)" fontSize="11">158 ft²</text>
            <text x="385" y="246" fill="#ffffff" fontSize="13" fontWeight="600">Primary bed</text>
            <text x="385" y="263" fill="rgba(255,255,255,0.6)" fontSize="11">237 ft²</text>
          </g>
          {/* selected room */}
          <rect x="290" y="160" width="190" height="180" fill="none" stroke="#2fb3bd" strokeWidth="1.5" strokeDasharray="5 4" />
          {[
            [290, 160],
            [480, 160],
            [480, 340],
            [290, 340],
          ].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x! - 4} y={y! - 4} width="8" height="8" fill="#0f2a33" stroke="#2fb3bd" strokeWidth="1.5" />
          ))}
        </svg>
        <div className="absolute bottom-[19%] right-[9%] w-[230px] rounded-lg border border-white/10 bg-[#0b1f26]/90 p-3.5 text-[12px] shadow-2xl backdrop-blur">
          <p className="text-[13px] font-semibold">Primary bed</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-white/70 tnum">
            <dt>Area</dt>
            <dd className="text-right text-white">237 ft²</dd>
            <dt>Volume</dt>
            <dd className="text-right text-white">1,896 ft³</dd>
            <dt>Exposed walls</dt>
            <dd className="text-right text-white">E, S</dd>
            <dt>Window area</dt>
            <dd className="text-right text-white">24.0 ft²</dd>
          </dl>
        </div>
      </div>
      <div className="relative max-w-[520px] px-12 pb-12">
        <p className="text-[22px] font-semibold leading-[1.25] tracking-[-0.02em]">
          Draw the house once. Size the system, the ducts and the proposal from the same model.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-white/65">
          Every dimension is stored to the sixteenth of an inch. Every missing input stays visibly missing until someone enters it.
        </p>
      </div>
    </aside>
  );
}
