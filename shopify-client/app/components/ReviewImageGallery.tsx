import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type OpenGallery = (images: string[], index: number, title: string) => void;

export function GalleryNavigation({ index, count, onMove }: {
  index: number;
  count: number;
  onMove: (step: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="review-gallery__navigation">
      <s-button type="button" variant="secondary" icon="chevron-left"
        accessibilityLabel={t("actions.previous")} onClick={() => onMove(-1)} />
      <span aria-live="polite">{index + 1} / {count}</span>
      <s-button type="button" variant="secondary" icon="chevron-right"
        accessibilityLabel={t("actions.next")} onClick={() => onMove(1)} />
    </div>
  );
}

export function ReviewImageGallery({ images, title, onOpen }: {
  images: string[]; title: string; onOpen: OpenGallery;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const imageKey = images.join("\n");
  useEffect(() => { setSelected(0); }, [imageKey]);
  const index = Math.min(selected, Math.max(0, images.length - 1));
  return <div className="review-gallery" aria-label={title}>
    <button type="button" className="review-modal__image-button"
      disabled={!images.length} aria-label={t("analysis.openProductImage", { title })}
      onClick={() => onOpen(images, index, title)}>
      {images[index] ? <img src={images[index]} alt={title} loading="lazy" /> : <span>{t("analysis.reviewLayout.noImage")}</span>}
    </button>
    {images.length > 1 && <>
      <GalleryNavigation index={index} count={images.length}
        onMove={step => setSelected((index + step + images.length) % images.length)} />
      <div className="review-gallery__thumbnails">
        {images.map((src, i) => <button type="button" key={src} aria-pressed={index === i}
          aria-label={`${title} (${i + 1} / ${images.length})`} onClick={() => setSelected(i)}>
          <img src={src} alt="" loading="lazy" />
        </button>)}
      </div>
    </>}
  </div>;
}
