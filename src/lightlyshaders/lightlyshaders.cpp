/*
 *   Copyright © 2015 Robert Metsäranta <therealestrob@gmail.com>
 *
 *   This program is free software; you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation; either version 2 of the License, or
 *   (at your option) any later version.
 *
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *   General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with this program; see the file COPYING.  if not, write to
 *   the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 *   Boston, MA 02110-1301, USA.
 */

#include "lightlyshaders.h"
#include "lightlyshaders_config.h"
#include <opengl/glutils.h>
#include <effect/effect.h>
#include <core/renderviewport.h>
#include <scene/scene.h>

Q_LOGGING_CATEGORY(LIGHTLYSHADERS, "kwin_effect_lightlyshaders", QtWarningMsg)

static void ensureResources()
{
    // Must initialize resources manually because the effect is a static lib.
    Q_INIT_RESOURCE(lightlyshaders);
}

namespace KWin {

KWIN_EFFECT_FACTORY_SUPPORTED_ENABLED(  LightlyShadersEffect,
                                        "lightlyshaders.json",
                                        return LightlyShadersEffect::supported();,
                                        return LightlyShadersEffect::enabledByDefault();)

LightlyShadersEffect::LightlyShadersEffect() : OffscreenEffect()
{
    ensureResources();

    m_helper = std::make_unique<LSHelper>();
    reconfigure(ReconfigureAll);

    m_shader = std::unique_ptr<GLShader>(ShaderManager::instance()->generateShaderFromFile(ShaderTrait::MapTexture, QStringLiteral(""), QStringLiteral(":/effects/lightlyshaders/shaders/lightlyshaders.frag")));

    if (!m_shader) {
        qCWarning(LIGHTLYSHADERS) << "Failed to load shader";
        return;
    }

    m_locations.frameSize = m_shader->uniformLocation("frame_size");
    m_locations.expandedSize = m_shader->uniformLocation("expanded_size");
    m_locations.shadowSize = m_shader->uniformLocation("shadow_size");
    m_locations.radius = m_shader->uniformLocation("radius");
    m_locations.shadowOffset = m_shader->uniformLocation("shadow_sample_offset");
    m_locations.innerOutlineColor = m_shader->uniformLocation("inner_outline_color");
    m_locations.outerOutlineColor = m_shader->uniformLocation("outer_outline_color");
    m_locations.innerOutlineWidth = m_shader->uniformLocation("inner_outline_width");
    m_locations.outerOutlineWidth = m_shader->uniformLocation("outer_outline_width");
    m_locations.drawInnerOutline = m_shader->uniformLocation("draw_inner_outline");
    m_locations.drawOuterOutline = m_shader->uniformLocation("draw_outer_outline");
    m_locations.squircleRatio = m_shader->uniformLocation("squircle_ratio");
    m_locations.isSquircle = m_shader->uniformLocation("is_squircle");

    const auto stackingOrder = effects->stackingOrder();
    for (EffectWindow *window : stackingOrder) {
        windowAdded(window);
    }

    connect(effects, &EffectsHandler::windowAdded, this, &LightlyShadersEffect::windowAdded);
    connect(effects, &EffectsHandler::windowDeleted, this, &LightlyShadersEffect::windowDeleted);

    qCWarning(LIGHTLYSHADERS) << "LightlyShaders loaded.";
}

LightlyShadersEffect::~LightlyShadersEffect()
{
    m_windows.clear();
}

void
LightlyShadersEffect::windowDeleted(EffectWindow *w)
{
    m_windows.remove(w);
}

void
LightlyShadersEffect::windowAdded(EffectWindow *w)
{
    if(!m_helper->isManagedWindow(w))
        return;

    LSWindowStruct &window = m_windows[w];
    window.isManaged = true;
    window.skipEffect = false;

    connect(w, &EffectWindow::windowMaximizedStateChanged,
            this, &LightlyShadersEffect::windowMaximizedStateChanged);
    connect(w, &EffectWindow::windowFullScreenChanged,
            this, &LightlyShadersEffect::windowFullScreenChanged);

    RectF maximized_area = effects->clientArea(MaximizeArea, w);
    if (maximized_area == w->frameGeometry() && m_disabledForMaximized)
        window.skipEffect = true;

    redirect(w);
    setShader(w, m_shader.get());
}

void
LightlyShadersEffect::windowFullScreenChanged(EffectWindow *w)
{
    auto it = m_windows.find(w);
    if (it == m_windows.end()) {
        return;
    }

    if(w->isFullScreen()) {
        it.value().isManaged = false;
    } else {
        it.value().isManaged = true;
    }
}

void
LightlyShadersEffect::windowMaximizedStateChanged(EffectWindow *w, bool horizontal, bool vertical)
{
    if (!m_disabledForMaximized) return;

    auto it = m_windows.find(w);
    if (it == m_windows.end()) {
        return;
    }

    if ((horizontal == true) && (vertical == true)) {
        it.value().skipEffect = true;
    } else {
        it.value().skipEffect = false;
    }
}

void
LightlyShadersEffect::setRoundness(const int r)
{
    m_size = r;
}

void
LightlyShadersEffect::reconfigure(ReconfigureFlags flags)
{
    Q_UNUSED(flags)

    LightlyShadersConfig::self()->load();

    m_innerOutlineWidth = LightlyShadersConfig::innerOutlineWidth();
    m_outerOutlineWidth = LightlyShadersConfig::outerOutlineWidth();
    m_innerOutline = LightlyShadersConfig::innerOutline();
    m_outerOutline = LightlyShadersConfig::outerOutline();
    m_innerOutlineColor = LightlyShadersConfig::innerOutlineColor();
    m_outerOutlineColor = LightlyShadersConfig::outerOutlineColor();
    m_disabledForMaximized = LightlyShadersConfig::disabledForMaximized();
    m_shadowOffset = LightlyShadersConfig::shadowOffset();
    m_squircleRatio = LightlyShadersConfig::squircleRatio();
    m_cornersType = LightlyShadersConfig::cornersType();

    m_helper->reconfigure();
    m_roundness = m_helper->roundness();

    if(m_shadowOffset>=m_roundness) {
        m_shadowOffset = m_roundness-1;
    }

    if(!m_innerOutline) {
        m_innerOutlineWidth = 0.0;
    }
    if(!m_outerOutline) {
        m_outerOutlineWidth = 0.0;
    }

    setRoundness(m_roundness);

    effects->addRepaintFull();
}

void
LightlyShadersEffect::prePaintWindow(RenderView *view, EffectWindow *w, WindowPrePaintData &data)
{
    if (!isValidWindow(w) )
    {
        effects->prePaintWindow(view, w, data);
        return;
    }

    data.setTranslucent();

    effects->prePaintWindow(view, w, data);
}

bool
LightlyShadersEffect::isValidWindow(EffectWindow *w)
{
    if (!m_shader) {
        return false;
    }

    auto it = m_windows.constFind(w);
    if (it == m_windows.constEnd()) {
        return false;
    }

    return it.value().isManaged && !it.value().skipEffect;
}

bool
LightlyShadersEffect::drawWindow(const RenderTarget &renderTarget, const RenderViewport &viewport, EffectWindow *w, int mask, const Region &region, WindowPaintData &data)
{
    RectF screen = viewport.renderRect().toRect();

    if (!isValidWindow(w) || (!screen.intersects(w->frameGeometry()) && !(mask & PAINT_WINDOW_TRANSFORMED)) )
    {
        return effects->drawWindow(renderTarget, viewport, w, mask, region, data);
    }

    RectF geo(w->frameGeometry());
    RectF exp_geo(w->expandedGeometry());

    const qreal scaleFactor = viewport.scale();
    const RectF geo_scaled = scale(geo, scaleFactor);
    const RectF exp_geo_scaled = scale(exp_geo, scaleFactor);

    //Draw rounded corners with shadows
    ShaderManager *sm = ShaderManager::instance();
    sm->pushShader(m_shader.get());

    //qCWarning(LIGHTLYSHADERS) << geo_scaled.width() << geo_scaled.height();
    m_shader->setUniform(m_locations.frameSize, QVector2D(geo_scaled.width(), geo_scaled.height()));
    m_shader->setUniform(m_locations.expandedSize, QVector2D(exp_geo_scaled.width(), exp_geo_scaled.height()));
    m_shader->setUniform(m_locations.shadowSize, QVector3D(geo_scaled.x() - exp_geo_scaled.x(), geo_scaled.y()-exp_geo_scaled.y(), geo_scaled.y() - exp_geo_scaled.y() ));
    m_shader->setUniform(m_locations.radius, float(m_size * scaleFactor));
    m_shader->setUniform(m_locations.shadowOffset, float(m_shadowOffset * scaleFactor));
    m_shader->setUniform(m_locations.innerOutlineColor, QVector4D(m_innerOutlineColor.red()/255.0,m_innerOutlineColor.green()/255.0,m_innerOutlineColor.blue()/255.0,m_innerOutlineColor.alpha()/255.0));
    m_shader->setUniform(m_locations.outerOutlineColor, QVector4D(m_outerOutlineColor.red()/255.0,m_outerOutlineColor.green()/255.0,m_outerOutlineColor.blue()/255.0,m_outerOutlineColor.alpha()/255.0));
    m_shader->setUniform(m_locations.innerOutlineWidth, float(m_innerOutlineWidth * scaleFactor));
    m_shader->setUniform(m_locations.outerOutlineWidth, float(m_outerOutlineWidth * scaleFactor));
    m_shader->setUniform(m_locations.drawInnerOutline, m_innerOutline);
    m_shader->setUniform(m_locations.drawOuterOutline, m_outerOutline);
    m_shader->setUniform(m_locations.squircleRatio, m_squircleRatio);
    m_shader->setUniform(m_locations.isSquircle, (m_cornersType == LSHelper::SquircledCorners));

    glActiveTexture(GL_TEXTURE0);

    const bool ret = OffscreenEffect::drawWindow(renderTarget, viewport, w, mask, region, data);

    sm->popShader();

    return ret;
}

RectF
LightlyShadersEffect::scale(const RectF rect, qreal scaleFactor)
{
    return RectF(
        rect.x()*scaleFactor,
        rect.y()*scaleFactor,
        rect.width()*scaleFactor,
        rect.height()*scaleFactor
    );
}

bool
LightlyShadersEffect::enabledByDefault()
{
    return supported();
}

bool
LightlyShadersEffect::supported()
{
    return effects->openglContext() && effects->openglContext()->checkSupported() && effects->openglContext()->supportsBlits();
}

} // namespace KWin

#include "lightlyshaders.moc"
