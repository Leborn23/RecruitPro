export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center">
        <h2 className="text-2xl font-medium text-on-surface mb-2">{title}</h2>
        <p className="text-on-surface-variant">This page is under construction.</p>
      </div>
    </div>
  );
}
