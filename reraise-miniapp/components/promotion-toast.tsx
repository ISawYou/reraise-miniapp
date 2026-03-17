type PromotionToastProps = {
  message: string;
};

export function PromotionToast({ message }: PromotionToastProps) {
  return (
    <div className="fixed left-4 right-4 top-24 z-50 flex justify-center">
      <div className="w-full max-w-md rounded-2xl border border-green-500/50 bg-green-950 px-4 py-3 text-sm font-medium text-green-100 shadow-2xl">
        {message}
      </div>
    </div>
  );
}