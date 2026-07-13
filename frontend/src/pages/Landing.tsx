import { useNavigate } from "react-router-dom";
import { ChevronRight, Headphones, ShieldCheck } from "lucide-react";
import Brand from "../components/Brand";

export default function Landing() {
  const nav = useNavigate();
  return (
    <div className="authWrap">
      <div className="landing">
        <Brand size="lg" />
        <p className="landingSub">Choose how you'd like to sign in.</p>
        <div className="landingBtns">
          <button className="loginChoice" onClick={() => nav("/login/admin")}>
            <span className="lcIcon"><ShieldCheck /></span>
            <span className="lcBody">
              <span className="lcTitle">Admin Login</span>
              <span className="lcDesc">Manage employees &amp; view assessments</span>
            </span>
            <ChevronRight className="lcArrow" size={18} />
          </button>
          <button className="loginChoice" onClick={() => nav("/login/employee")}>
            <span className="lcIcon"><Headphones /></span>
            <span className="lcBody">
              <span className="lcTitle">Employee Login</span>
              <span className="lcDesc">Practice and get assessed</span>
            </span>
            <ChevronRight className="lcArrow" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
