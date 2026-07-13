import { AudioLines } from "lucide-react";
import { BRAND, BRAND_TAGLINE } from "../brand";

// Product wordmark: a gradient voice-wave mark + the brand name.
export default function Brand({ sub, size = "md" }: { sub?: string; size?: "md" | "lg" }) {
  return (
    <div className={`brand brand-${size}`}>
      <div className="brandMark">
        <AudioLines strokeWidth={2.25} />
      </div>
      <div className="brandText">
        <div className="brandName">{BRAND}</div>
        <div className="brandSub">{sub ?? BRAND_TAGLINE}</div>
      </div>
    </div>
  );
}
