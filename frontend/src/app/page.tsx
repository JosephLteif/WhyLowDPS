export default function Home() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-gold to-gold-dark shadow-glow-lg">
        <svg className="h-8 w-8 text-black" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2l10 6-10 6V2z" />
        </svg>
      </div>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-100">Welcome to WhyLowDps</h1>
      <p className="text-base text-zinc-400">Select a simulation type from the sidebar on the left to get started.</p>
    </div>
  );
}
