export default function Home() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center text-center">
      <img
        src="/icon.png"
        alt="WhyLowDps"
        className="mb-4 h-16 w-16 rounded-2xl shadow-glow-lg ring-1 ring-white/10"
      />
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-100">Welcome to WhyLowDps</h1>
      <p className="text-base text-zinc-400">
        Select a simulation type from the sidebar on the left to get started.
      </p>
    </div>
  );
}
