// The icons the sign-in screens draw, copied from lucide-react 0.577 (ISC) as
// testbench renders them, so the package needs no icon library. Size comes from
// CSS; the attributes are lucide's defaults.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function lucide(name: string, paths: ReactNode) {
  return function Icon({ size = 24, className = "", ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`lucide lucide-${name}${className ? ` ${className}` : ""}`}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const LoaderCircle = lucide("loader-circle", <path d="M21 12a9 9 0 1 1-6.219-8.56" />);
export const Moon = lucide(
  "moon",
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />,
);
export const Sun = lucide(
  "sun",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>,
);
export const TriangleAlert = lucide(
  "triangle-alert",
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>,
);
export const ChevronRight = lucide("chevron-right", <path d="m9 18 6-6-6-6" />);

/** The Tacit mark, as testbench's staff brand draws it. */
export function TacitMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="8.57578125 9.61484375 63.0984375 60.39750308990479"
      height={size}
      width={(size * 63.1) / 60.4}
      aria-hidden="true"
      fill="currentColor"
    >
      <path
        transform="translate(-3 3)"
        d="m67.08 8.12h-28.16c-3.58 0-6.05 2.43-6.05 5.63 0 3.07 2.36 5.46 5.57 5.46h17.16c3.1 0 5.48 2.15 5.48 4.96l0.06 16.44c0 3.16 2.61 5.43 6.04 5.43 3.49 0 5.99-2.37 5.99-5.35v-26.88c0-3.36-2.56-5.69-6.09-5.69z"
      />
      <path
        transform="translate(3 -3)"
        d="m43.97 59.61h-20.06c-2.85 0-4.69-1.73-4.69-4.47v-19.65c0-3.38-2.72-5.57-6.11-5.57-3.46 0-6.03 2.27-6.03 5.79v29.65c0 3.58 2.76 6.15 6.39 6.15h30.5c3.48 0 6.18-2.65 6.18-5.92 0-3.35-2.8-5.98-6.18-5.98z"
      />
    </svg>
  );
}
