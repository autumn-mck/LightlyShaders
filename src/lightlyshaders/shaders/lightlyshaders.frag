#version 140

uniform sampler2D sampler;

uniform vec2 expanded_size;
uniform vec2 frame_size;
uniform vec3 shadow_size;
uniform float radius;
uniform float shadow_sample_offset;
uniform bool draw_inner_outline;
uniform bool draw_outer_outline;
uniform float inner_outline_width;
uniform float outer_outline_width;
uniform vec4 inner_outline_color;
uniform vec4 outer_outline_color;
uniform int squircle_ratio;
uniform bool is_squircle;

uniform mat4 modelViewProjectionMatrix;

uniform vec4 modulation;
uniform float saturation;

in vec2 texcoord0;
out vec4 fragColor;

#include "colormanagement.glsl"

//Used code from https://github.com/yilozt/rounded-window-corners project
float squircleBounds(vec2 p, vec2 center, float clip_radius)
{
    vec2 delta = abs(p - center);
    float f_squircle_ratio = float(squircle_ratio);

    float pow_dx = pow(delta.x, f_squircle_ratio);
    float pow_dy = pow(delta.y, f_squircle_ratio);

    float dist = pow(pow_dx + pow_dy, 1.0 / f_squircle_ratio);

    return clamp(clip_radius - dist + 0.5, 0.0, 1.0);
}

//Used code from https://github.com/yilozt/rounded-window-corners project
float circleBounds(vec2 p, vec2 center, float clip_radius)
{
    vec2 delta = p - vec2(center.x, center.y);
    float dist_squared = dot(delta, delta);

    float outer_radius = clip_radius + 0.5;
    if(dist_squared >= (outer_radius * outer_radius))
        return 0.0;

    float inner_radius = clip_radius - 0.5;
    if(dist_squared <= (inner_radius * inner_radius))
        return 1.0;

    return outer_radius - sqrt(dist_squared);
}

vec4 shapeWindow(vec4 tex, vec2 p, vec2 center, float clip_radius)
{
    float alpha;
    if(is_squircle) {
        alpha = squircleBounds(p, center, clip_radius);
    } else {
        alpha = circleBounds(p, center, clip_radius);
    }
    return vec4(tex.rgb*alpha, min(alpha, tex.a));
}

float cornerBounds(vec2 p, vec2 center, float clip_radius)
{
    if(is_squircle) {
        return squircleBounds(p, center, clip_radius);
    }
    return circleBounds(p, center, clip_radius);
}

vec4 sampleShadow(vec2 pos)
{
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x > expanded_size.x || pos.y > expanded_size.y) {
        return vec4(0.0);
    }
    return texture(sampler, pos / expanded_size);
}

//Decoration shadows are drawn for square corners; rebuild it around the rounded one
vec4 cornerShadow(vec2 p, vec2 center, vec2 dir, float clip_radius)
{
    float f_shadow_sample_offset = float(shadow_sample_offset);
    vec2 corner = center + dir * clip_radius;

    vec4 patched = texture(sampler, texcoord0);
    vec2 outside = dir * (p - corner);
    if (outside.x < max(f_shadow_sample_offset, outer_outline_width) && outside.y < max(f_shadow_sample_offset, outer_outline_width)) {
        vec2 start = (corner + dir * f_shadow_sample_offset) / expanded_size;
        patched = clamp(texture(sampler, vec2(texcoord0.x, start.y)) + texture(sampler, vec2(start.x, texcoord0.y)) - texture(sampler, start), 0.0, 1.0);
    }

    vec2 inset_min = vec2(shadow_size.x, shadow_size.z);
    vec2 inset_max = expanded_size - frame_size - inset_min;
    float extent = (inset_min.x + inset_min.y + inset_max.x + inset_max.y) * 0.25;
    float weight = smoothstep(0.3 * extent, 0.8 * extent, clip_radius);
    if (weight <= 0.0) {
        return patched;
    }

    vec2 shift = (inset_max - inset_min) * 0.5;
    vec2 v = p - center;
    float len = max(length(v), 0.001);
    float s = len - clip_radius - dot(v / len, shift);
    float horizontal_dist = max(s + dir.y * shift.y, f_shadow_sample_offset);
    float vertical_dist = max(s + dir.x * shift.x, f_shadow_sample_offset);
    vec4 horizontal = sampleShadow(vec2(center.x, corner.y + dir.y * horizontal_dist));
    vec4 vertical = sampleShadow(vec2(corner.x + dir.x * vertical_dist, center.y));
    float t = atan(abs(v.x), abs(v.y) + 0.000001) / 1.5707963;
    vec4 rebuilt = mix(horizontal, vertical, t);

    return mix(patched, rebuilt, weight);
}

//Corner of a window with shadow, including its outlines.
//The outer outline is laid under the window and the window is blended over it, instead of
//blending window->shadow and then outline->result, which lets the background leak through
//antialiased edge pixels.
vec4 shapeShadowWindow(vec4 shadow, vec4 tex, vec2 p, vec2 center, float clip_radius)
{
    vec4 outColor = shadow;

    if(draw_outer_outline) {
        float outer_alpha = cornerBounds(p, center, clip_radius + outer_outline_width);
        outColor = mix(outColor, vec4(outer_outline_color.rgb, 1.0), outer_alpha * outer_outline_color.a);
    }

    float alpha = cornerBounds(p, center, clip_radius);
    outColor = mix(outColor, tex, alpha);

    if(draw_inner_outline) {
        float inner_alpha = alpha - cornerBounds(p, center, clip_radius - inner_outline_width);
        outColor = mix(outColor, vec4(inner_outline_color.rgb, 1.0), inner_alpha * inner_outline_color.a);
    }

    return outColor;
}

vec4 cornerOutline(vec4 outColor, bool inner, vec2 coord0, float radius, vec2 center, float outline_width, bool invert)
{
    vec4 outline_color;
    float radius_delta_inner;
    float radius_delta_outer;

    if(inner) {
        outline_color = inner_outline_color;
        radius_delta_outer = 0.0;
        radius_delta_inner = -outline_width;

        if(invert) {
            radius_delta_inner = 0.0;
            radius_delta_outer = outline_width;
        }
    } else {
        outline_color = outer_outline_color;
        radius_delta_inner = 0.0;
        radius_delta_outer = outline_width;

        if(invert) {
            radius_delta_outer = 0.0;
            radius_delta_inner = -outline_width;
        }
    }

    float outline_alpha;
    float outline_alpha_inner;
    float outline_alpha_outer;

    if(is_squircle) {
        outline_alpha_inner = squircleBounds(coord0, vec2(center.x, center.y), radius + radius_delta_inner);
        outline_alpha_outer = squircleBounds(coord0, vec2(center.x, center.y), radius + radius_delta_outer);
    } else {
        outline_alpha_inner = circleBounds(coord0, vec2(center.x, center.y), radius + radius_delta_inner);
        outline_alpha_outer = circleBounds(coord0, vec2(center.x, center.y), radius + radius_delta_outer);
    }
    outline_alpha = 1.0 - clamp(abs(outline_alpha_outer - outline_alpha_inner), 0.0, 1.0);
    outColor = mix(outColor, vec4(outline_color.rgb,1.0), (1.0-outline_alpha) * outline_color.a);
    return outColor;
}

void main()
{
    vec4 tex = texture(sampler, texcoord0);
    vec2 coord0;
    vec4 outColor;
    float start_x;
    float start_y;

    float f_shadow_sample_offset = float(shadow_sample_offset);
    float f_radius = float(radius);

    //Window without shadow
    if(expanded_size == frame_size) {
        coord0 = vec2(texcoord0.x*frame_size.x, texcoord0.y*frame_size.y);
        //Left side
        if (coord0.x < f_radius) {
            //Bottom left corner
            if (coord0.y < f_radius) {
                outColor = shapeWindow(tex, coord0, vec2(f_radius, f_radius), f_radius);

                //Inner outline
                if(draw_inner_outline) {
                    outColor = cornerOutline(outColor, true, coord0, f_radius-outer_outline_width, vec2(f_radius, f_radius), inner_outline_width, false);
                }
                //Outer outline
                if(draw_outer_outline) {
                    outColor = cornerOutline(outColor, false, coord0, f_radius, vec2(f_radius, f_radius), outer_outline_width, true);
                }
            //Top left corner
            } else if (coord0.y > frame_size.y - f_radius) {
                outColor = shapeWindow(tex, coord0, vec2(f_radius, frame_size.y - f_radius), f_radius);

                //Inner outline
                if(draw_inner_outline) {
                    outColor = cornerOutline(outColor, true, coord0, f_radius-outer_outline_width, vec2(f_radius, frame_size.y - f_radius), inner_outline_width, false);
                }
                //Outer outline
                if(draw_outer_outline) {
                    outColor = cornerOutline(outColor, false, coord0, f_radius, vec2(f_radius, frame_size.y - f_radius), outer_outline_width, true);
                }
            //Center
            } else {
                outColor = tex;

                //Outline
                if(coord0.y > f_radius && coord0.y < frame_size.y - f_radius) {
                    //Inner outline
                    if(draw_inner_outline) {
                        if(coord0.x >= outer_outline_width && coord0.x <= outer_outline_width+inner_outline_width) {
                            outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                        }
                    }
                    //Outer outline
                    if(draw_outer_outline) {
                        if(
                            (coord0.x >= 0.0 && coord0.x <= outer_outline_width)
                        ) {
                            outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                        }
                    }
                }
            }
        //Right side
        } else if (coord0.x > frame_size.x - f_radius) {
            //Bottom right corner
            if (coord0.y < f_radius) {
                outColor = shapeWindow(tex, coord0, vec2(frame_size.x - f_radius, f_radius), f_radius);

                //Inner outline
                if(draw_inner_outline) {
                    outColor = cornerOutline(outColor, true, coord0, f_radius-outer_outline_width, vec2(frame_size.x - f_radius, f_radius), inner_outline_width, false);
                }
                //Outer outline
                if(draw_outer_outline) {
                    outColor = cornerOutline(outColor, false, coord0, f_radius, vec2(frame_size.x - f_radius, f_radius), outer_outline_width, true);
                }
            //Top right corner
            } else if (coord0.y > frame_size.y - f_radius) {
                outColor = shapeWindow(tex, coord0, vec2(frame_size.x - f_radius, frame_size.y - f_radius), f_radius);

                //Inner outline
                if(draw_inner_outline) {
                    outColor = cornerOutline(outColor, true, coord0, f_radius-outer_outline_width, vec2(frame_size.x - f_radius, frame_size.y - f_radius), inner_outline_width, false);
                }
                //Outer outline
                if(draw_outer_outline) {
                    outColor = cornerOutline(outColor, false, coord0, f_radius, vec2(frame_size.x - f_radius, frame_size.y - f_radius), outer_outline_width, true);
                }
            //Center
            } else {
                outColor = tex;

                //Outline
                if(coord0.y > f_radius && coord0.y < frame_size.y - f_radius) {
                    //Inner outline
                    if(draw_inner_outline) {
                        if(coord0.x >= frame_size.x - inner_outline_width - outer_outline_width && coord0.x <= frame_size.x - outer_outline_width) {
                            outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                        }
                    }
                    //Outer outline
                    if(draw_outer_outline) {
                        if(
                            (coord0.x >= frame_size.x - outer_outline_width && coord0.x <= frame_size.x )
                        ) {
                            outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                        }
                    }
                }
            }
        //Center
        } else {
            outColor = tex;

            //Outline
            if(coord0.x > f_radius && coord0.x < frame_size.x - f_radius) {
                //Inner outline
                if(draw_inner_outline) {
                    if(
                        (coord0.y >= frame_size.y - inner_outline_width - outer_outline_width && coord0.y <= frame_size.y - outer_outline_width )
                        || (coord0.y >= outer_outline_width && coord0.y <= outer_outline_width + inner_outline_width)
                    ) {
                        outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                    }
                }
                //Outer outline
                if(draw_outer_outline) {
                    if(
                        (coord0.y >= frame_size.y - outer_outline_width  && coord0.y <= frame_size.y)
                        || (coord0.y >= 0.0 && coord0.y <= outer_outline_width)
                    ) {
                        outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                    }
                }
            }
        }
    //Window with shadow
    } else if(expanded_size != frame_size) {
        coord0 = vec2(texcoord0.x*expanded_size.x, texcoord0.y*expanded_size.y);
        bool in_left = coord0.x < shadow_size.x + f_radius;
        bool in_right = coord0.x > shadow_size.x + frame_size.x - f_radius;
        bool in_top = coord0.y < shadow_size.z + f_radius;
        bool in_bottom = coord0.y > shadow_size.z + frame_size.y - f_radius;
        //Corners
        if ((in_left || in_right) && (in_top || in_bottom)) {
            vec2 dir = vec2(in_left ? -1.0 : 1.0, in_top ? -1.0 : 1.0);
            vec2 center = vec2(in_left ? shadow_size.x + f_radius : shadow_size.x + frame_size.x - f_radius,
                               in_top ? shadow_size.z + f_radius : shadow_size.z + frame_size.y - f_radius);
            outColor = shapeShadowWindow(cornerShadow(coord0, center, dir, f_radius), tex, coord0, center, f_radius);
        //Left side
        } else if (coord0.x > shadow_size.x - max(f_shadow_sample_offset, outer_outline_width) && coord0.x < f_radius + shadow_size.x) {
            outColor = tex;

            //Outline and shadow
            if(coord0.y > f_radius + shadow_size.z && coord0.y < shadow_size.z + frame_size.y - f_radius) {
                //Left shadow padding
                if(coord0.x > shadow_size.x - f_shadow_sample_offset && coord0.x <= shadow_size.x) {
                    start_x = (shadow_size.x - f_shadow_sample_offset)/expanded_size.x;                        
                    vec4 texShadowEdge = texture(sampler, vec2(start_x, texcoord0.y));
                    outColor = texShadowEdge;
                }

                //Inner outline
                if(draw_inner_outline) {
                    if(coord0.x >= shadow_size.x && coord0.x <= shadow_size.x+inner_outline_width) {
                        outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                    }
                }
                //Outer outline
                if(draw_outer_outline) {
                    if(
                        (coord0.x >= shadow_size.x - outer_outline_width && coord0.x <= shadow_size.x)
                    ) {
                        outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                    }
                }
            }
        //Right side
        } else if (coord0.x > shadow_size.x + frame_size.x - f_radius && coord0.x < shadow_size.x + frame_size.x + max(f_shadow_sample_offset, outer_outline_width)) {
            outColor = tex;

            //Outline and shadow
            if(coord0.y > f_radius + shadow_size.z && coord0.y < shadow_size.z + frame_size.y - f_radius) {
                //Right shadow padding
                if(coord0.x >= shadow_size.x + frame_size.x && coord0.x < shadow_size.x + frame_size.x + f_shadow_sample_offset) {
                    start_x = (shadow_size.x + frame_size.x + f_shadow_sample_offset)/expanded_size.x;
                    vec4 texShadowEdge = texture(sampler, vec2(start_x, texcoord0.y));
                    outColor = texShadowEdge;
                }

                //Inner outline
                if(draw_inner_outline) {
                    if(coord0.x >= frame_size.x + shadow_size.x - inner_outline_width && coord0.x <= frame_size.x + shadow_size.x) {
                        outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                    }
                }
                //Outer outline
                if(draw_outer_outline) {
                    if(
                        (coord0.x >= frame_size.x + shadow_size.x && coord0.x <= frame_size.x + shadow_size.x + outer_outline_width)
                    ) {
                        outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                    }
                }
            }
        //Center
        } else {
            outColor = tex;

            //Outline and shadow
            if(coord0.x > f_radius + shadow_size.x && coord0.x < shadow_size.x + frame_size.x - f_radius) {
                //Top shadow padding
                if(coord0.y >= frame_size.y + shadow_size.z && coord0.y < frame_size.y + shadow_size.z + f_shadow_sample_offset) {
                    start_y = (shadow_size.z + frame_size.y + f_shadow_sample_offset)/expanded_size.y;
                    vec4 texShadowEdge = texture(sampler, vec2(texcoord0.x, start_y));
                    outColor = texShadowEdge;
                //Bottom shadow padding
                } else if(coord0.y <= shadow_size.z && coord0.y > shadow_size.z - f_shadow_sample_offset) {
                    start_y = (shadow_size.z - f_shadow_sample_offset)/expanded_size.y;
                    vec4 texShadowEdge = texture(sampler, vec2(texcoord0.x, start_y));
                    outColor = texShadowEdge;
                }

                //Inner outline
                if(draw_inner_outline) {
                    if(
                        (coord0.y >= frame_size.y + shadow_size.z - inner_outline_width && coord0.y <= frame_size.y + shadow_size.z)
                        || (coord0.y >= shadow_size.z && coord0.y <= shadow_size.z + inner_outline_width)
                    ) {
                        outColor = mix(outColor, vec4(inner_outline_color.rgb,1.0), inner_outline_color.a);
                    }
                }
                //Outer outline
                if(draw_outer_outline) {
                    if(
                        (coord0.y >= frame_size.y + shadow_size.z && coord0.y <= frame_size.y + shadow_size.z + outer_outline_width)
                        || (coord0.y >= shadow_size.z - outer_outline_width && coord0.y <= shadow_size.z)
                    ) {
                        outColor = mix(outColor, vec4(outer_outline_color.rgb,1.0), outer_outline_color.a);
                    }
                }
            }
        }
    }

    outColor = sourceEncodingToNitsInDestinationColorspace(outColor);

    //Support opacity
    if (saturation != 1.0) {
        vec3 desaturated = outColor.rgb * vec3( 0.30, 0.59, 0.11 );
        desaturated = vec3( dot( desaturated, outColor.rgb ));
        outColor.rgb = outColor.rgb * vec3( saturation ) + desaturated * vec3( 1.0 - saturation );
    }
    outColor *= modulation;

    //Output result
    fragColor = nitsToDestinationEncoding(outColor);
    //fragColor = vec4(tex.r, tex.g, 1.0, tex.a);
}
