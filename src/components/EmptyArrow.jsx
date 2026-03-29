export default function EmptyArrow({ message = "Add a task to get started!" }) {
  return (
    <div className="flex flex-col items-end pr-16 sm:pr-24 pt-2">
      {/* Curvy arrow pointing up-right toward the New Task button */}
      <svg
        width="80"
        height="70"
        viewBox="0 0 80 70"
        fill="none"
        className="text-slate-300 mb-1"
      >
        {/* Curvy arrow path going up-right */}
        <path
          d="M 10 60 C 10 30, 50 30, 65 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          strokeDasharray="0"
        />
        {/* Arrowhead */}
        <path
          d="M 65 10 L 58 20 M 65 10 L 74 16"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-slate-400 text-sm text-right -mt-1">{message}</p>
    </div>
  );
}