
# Animated vector drawables for Keyshape

This [Keyshape](https://www.keyshapeapp.com) plugin adds support for importing and exporting
[vector drawables and animated vector drawables](https://developer.android.com/guide/topics/graphics/vector-drawable-resources.html)
for Android apps.

After installing the plugin, it is possible to open animated vector drawables in Keyshape
for editing. It is also possible to export animated vector drawables.

## Installing

1. Go to [Releases](https://github.com/Pixofield/keyshape-avd-format/releases) 
   and download the latest _AVD-format.keyshapeplugin_
2. Double-click the downloaded _AVD-format.keyshapeplugin_ to install it in Keyshape

The plugin can be updated with the same procedure: download the latest release and install it.

## Importing Vector Drawables

After installation, just use the **File > Open** menu command in Keyshape to open vector drawable
files. They have _.xml_ file suffix and should start with a `<vector>` or `<animated-vector>`
XML tag.

Most vector drawable features are imported successfully, but there are few limitations:

 * pivotX and pivotY animations are not supported
 * easing interpolators (such as linear_out_slow_in) are approximated with cubic beziers
 * attribute references, such as "@string", are not supported
 * style attribute references, such as "?android:textColorSecondary", are not supported
 * the elements and attributes must use the `android:` and `aapt:` prefixes, other prefixes
   are not supported
 * overlapping animations targeting the same property in objectAnimators may not work correctly
 * cannot read animations which derive values from the target object (all keyframes must explicitely
   define a value)
 * repeatCount is ignored if multiple objectAnimators target the same property
 * only basic line animations made with path trim start, end and offset are supported
 * path trim start, end and offset animations are mapped to SVG dash offset animations

## Exporting Vector Drawables

After installation, the _Vector Drawable_ and _Animated Vector Drawable_ export options can be
found in the export dialog.

Exporting these properties is supported: position, rotate, scale, anchor, fill color,
fill rule, fill opacity, stroke color, stroke opacity, stroke linecap, stroke linejoin,
stroke miterlimit, path data.

NOTE: Unsupported are: opacity (supported only for the top-most document object),
stroke dash arrays, blending modes, skew, filters and bitmap images.

Animatable properties are: position, rotate, scale, anchor, fill color, fill opacity,
stroke color, stroke width, stroke opacity, path data. The top-most document object opacity can
also be animated. Stroke dash offset animations are mapped to path trimming animations.

Vector drawables and animated vector drawables are exported into a single XML file.

Exporting has few limitations:

 * gradients can have maximum three color stops and their position is always at the start,
   center and end of the gradient
 * text gets converted to paths (no emojis)
 * symbols create duplicate code, which can create large files
 * skew is not supported because AVDs don't support skewing
 * clipping paths only support path shape animations (no transform animations)
 * clipping paths can only have one path object
 * only one clipping path per object is allowed
 * masks are treated as clipping paths
 * stroke dash offset animations are exported as path trimming animations
 * repeating is not supported

## Required Android API levels

The exported vector drawables require different API levels depending on the features used. See 
the [Android documentation](https://developer.android.com/guide/topics/graphics/vector-drawable-resources.html)
for details, but here's a summary:

 * Basic animated vector drawables require API level 21+ (Android 5.0)
 * Non-linear easing (path interpolators) requires API level 24+ (Android 7.0)
 * Gradients require API level 24+
 * The even-odd fill rule requires API level 24+
 * [The support library](https://developer.android.com/guide/topics/graphics/vector-drawable-resources.html#vector-drawables-backward-solution)
   can show some static vector drawables at API level 7+ and animated vector drawables 
   at API level 11+

## License

MIT License, see the LICENSE file for details.
