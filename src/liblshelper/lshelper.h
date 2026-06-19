#include "liblshelper_export.h"

#include <core/region.h>
#include <effect/effecthandler.h>
#include <QRegion>
#include <QImage>
#include <QPainterPath>

#include <array>
#include <memory>

template <typename T> int signum(T val) {
    return (T(0) < val) - (val < T(0));
}

namespace KWin {

class LIBLSHELPER_EXPORT LSHelper: public QObject
{
    Q_OBJECT

	public:
		LSHelper();
		~LSHelper();

		void reconfigure();
		QPainterPath superellipse(float size, int n, int translate);
    	QImage genMaskImg(int size, bool mask, bool outer_rect);
		void roundBlurRegion(EffectWindow *w, Region *region);
		void roundBlurRegion(EffectWindow *w, RegionF *region);
		bool isManagedWindow(EffectWindow *w);
		void blurWindowAdded(EffectWindow *w);
		void blurWindowDeleted(EffectWindow *w);
		int roundness();

		enum { RoundedCorners = 0, SquircledCorners };
		enum { TopLeft = 0, TopRight, BottomRight, BottomLeft, NTex };

		std::array<std::unique_ptr<Region>, NTex> m_maskRegions;

	private:
		bool hasShadow(EffectWindow *w);
		void setMaskRegions();
		std::unique_ptr<Region> createMaskRegion(QImage img, int size, int corner);

		int m_size, m_cornersType, m_squircleRatio, m_shadowOffset;
		bool m_disabledForMaximized;
		QList<EffectWindow *> m_managed;
};

} //namespace
