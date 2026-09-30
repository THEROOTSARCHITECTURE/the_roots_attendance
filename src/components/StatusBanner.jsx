export default function StatusBanner({ online, pending }) {
  if (online && !pending) return null;
  const text = !online
    ? `You're offline.${pending ? ` ${pending} punch${pending > 1 ? 'es' : ''} will sync when you reconnect.` : ' Punches will be saved and synced later.'}`
    : `Syncing ${pending} saved punch${pending > 1 ? 'es' : ''}…`;
  return (
    <div className={`px-4 py-2 text-center text-sm ${online ? 'bg-amber-100 text-amber-900' : 'bg-gray-800 text-white'}`}>
      {text}
    </div>
  );
}
