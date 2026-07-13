import { useState, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

// Password field with a small eye icon inside to toggle visibility.
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete = "current-password",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const syncCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsOn(e.getModifierState("CapsLock"));
  };

  return (
    <>
      <div className="pwdWrap">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          onKeyDown={syncCaps}
          onKeyUp={syncCaps}
          onBlur={() => setCapsOn(false)}
        />
        <button
          type="button"
          className="pwdToggle"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={17} strokeWidth={1.9} /> : <Eye size={17} strokeWidth={1.9} />}
        </button>
      </div>
      {capsOn && <div className="capsHint" role="status">Caps Lock is ON</div>}
    </>
  );
}
