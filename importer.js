
// Keyshape Importer for Animated Vector Drawables and Vector Drawables

class SaxReader
{
    constructor(str) {
        this._xmlstr = str;
        this._pos = 0;
    }

    readUntil(str)
    {
        let newpos = this._xmlstr.indexOf(str, this._pos);
        if (newpos < 0) {
            throw "Invalid XML, expected to find: '"+str+"'";
        }
        let txt = this._xmlstr.substring(this._pos, newpos);
        this._pos = newpos;
        return txt;
    }

    readUntil3(str1, str2, str3)
    {
        let newpos1 = this._xmlstr.indexOf(str1, this._pos);
        let newpos2 = this._xmlstr.indexOf(str2, this._pos);
        let newpos3 = this._xmlstr.indexOf(str3, this._pos);
        if (newpos1 < 0 && newpos2 < 0 && newpos3 < 0) {
            throw "Invalid XML, expected to find: '"+str1+"', '"+str2+"'"+"' or '"+str2+"'";
        }
        let newpos = newpos1 < newpos2 ? newpos1 : newpos2;
        newpos = newpos < newpos3 ? newpos : newpos3;
        let txt = this._xmlstr.substring(this._pos, newpos);
        this._pos = newpos;
        return txt;
    }

    readn(n)
    {
        let txt = this._xmlstr.substr(this._pos, n);
        this._pos += n;
        return txt;
    }

    peek()
    {
        return this._xmlstr.substr(this._pos, 1);
    }

    isWhiteSpace(ch)
    {
        return /\s/.test(ch);
    }

    hasChars(chrs)
    {
        return this._xmlstr.substr(this._pos, chrs.length) == chrs;
    }

    skipWhiteSpace()
    {
        while (this.isWhiteSpace(this.peek())) {
            this._pos += 1;
        }
    }

    skipTextContent()
    {
        while (this.peek() != '<' && this._pos < this._xmlstr.length) {
            this._pos += 1;
        }
    }

    parse(callback)
    {
        while (this._pos < this._xmlstr.length) {
            this.skipTextContent();
            if (this.hasChars("<?")) { // processing instruction
                this.readn(2);
                let data = this.readUntil("?>");
                this.readn(2);
                if (callback.processingInstruction) callback.processingInstruction(data);

            } else if (this.hasChars("<!--")) { // comment
                this.readn(2);
                let data = this.readUntil("-->");
                this.readn(3);
                if (callback.comment) callback.comment(data);

            } else if (this.hasChars("</")) { // end tag
                this.readn(2);
                let tag = this.readUntil(">");
                this.readn(1);
                if (callback.endElement) callback.endElement(tag.trim());

            } else if (this.hasChars("<")) { // start tag
                this.readn(1);
                let tag = this.readUntil3(' ', '/', '>').trim();
                // get attributes
                let attrs = {};
                this.skipWhiteSpace();
                while (this.peek() != '/' && this.peek() != '>') {
                    let attrName = this.readUntil('=').trim();
                    this.readn(1);
                    this.skipWhiteSpace();
                    if (this.peek() != '"') {
                        throw "Bad attribute: "+tag;
                    }
                    this.readn(1);
                    let attrValue = this.readUntil('"');
                    this.readn(1);
                    attrs[attrName] = attrValue;
                    this.skipWhiteSpace();
                }
                if (callback.startElement) callback.startElement(tag, attrs);
                if (this.peek() == '/') {
                    this.readn(1);
                    if (callback.endElement) callback.endElement(tag);
                }
                if (this.peek() != '>') {
                    throw "Bad element: "+tag;
                }
                this.readn(1);
            }
        }
    }
};

// build a DOM from the given string
// each element in the DOM has properties:
// { tagName: "tag", attributes: { "name": "value" }, children: [ element* ] }
class DomBuilder
{
    constructor(str) {
        this._doc = { children: [] };
        this._stack = [ this._doc ];
    }

    getDocument()
    {
        return this._doc;
    }

    current()
    {
        return this._stack[this._stack.length - 1];
    }

    startElement(tag, attrs)
    {
        let elem = { tagName: tag, attributes: attrs, children: [] };
        this.current().children.push(elem);
        this._stack.push(elem);
    }

    endElement(tag)
    {
        this._stack.pop();
    }
}

function parseDom(content)
{
    let sax = new SaxReader(content);
    let builder = new DomBuilder();
    sax.parse(builder);
    return builder.getDocument();
}

// gets a filename URL, byte array and string to check if this importer can read the file
function doRecognize(filenameUrl, array, str)
{
    let hasTag = str.indexOf("animated-vector") > 0 || str.indexOf("vector") > 0;
    if (filenameUrl.href.toLowerCase().endsWith(".xml") && hasTag) {
        return 100;
    }
    return 0;
}

// global DOM document
let ksdoc;

// stack of KSElements to build the KSDocument
let elementStack = [];

// a map from element id to pivot element id, if the element has a pivot element
let pivotElementIds = {};

// imports the given file
function doImport(filenameUrl)
{
    let content = app.fs.readFileSync(filenameUrl, { encoding: 'utf-8' });
    let dom = parseDom(content);
    let rootElement = dom.children.length > 0 ? dom.children[0] : "invalid";
    ksdoc = app.activeDocument;

    // vector: static graphics
    if (rootElement.tagName == "vector") {
        processVector(rootElement);
        mapSkewToDash(ksdoc.documentElement);
        return;
    }

    // animated vector
    if (rootElement.tagName != "animated-vector") {
        throw "File is not a valid animated vector drawable.";
    }
    if (rootElement.children.length == 0 || rootElement.children[0].tagName != "aapt:attr" ||
            rootElement.children[0].attributes["name"] != "android:drawable") {
        throw "File is not a valid animated vector drawable, " +
                "the 'aapt:attr' element with 'android:drawable' is not found.";
    }
    let drawable = rootElement.children[0];
    if (drawable.children.length == 0 || drawable.children[0].tagName != "vector") {
        throw "File is not a valid animated vector drawable, the 'vector' element is not found.";
    }
    processVector(drawable.children[0]);
    processAnimations(rootElement);
    simplifyAnimations(ksdoc.documentElement);
    mapSkewToDash(ksdoc.documentElement);
}

function processVector(vector)
{
    // read viewport
    let vpw = 0, vph = 0;
    if (vector.attributes['android:viewportWidth']) {
        vpw = vector.attributes['android:viewportWidth'];
    }
    if (vector.attributes['android:viewportHeight']) {
        vph = vector.attributes['android:viewportHeight'];
    }
    if (vpw != 0 && vph != 0) {
        ksdoc.documentElement.setProperty("viewBox", "0 0 "+vpw+" "+vph);
    }
    copyProperty(vector, "android:alpha", ksdoc.documentElement, "opacity");
    copyProperty(vector, "android:name", ksdoc.documentElement, "id");

    // process children
    elementStack = [ ksdoc.documentElement ];
    processRenderable(vector.children);
}

function removeAllKeyframes(element, property)
{
    if (!element.timeline().hasKeyframes(property)) {
        return;
    }
    let kfs = element.timeline().getKeyframes(property);
    for (let kf of kfs) {
        element.timeline().removeKeyframe(property, kf.time);
    }
}

// maps skew, dasharray and dashoffset (Android trim path start, end, offset)
// to svg dasharray and offset
function mapSkewToDash(element)
{
    for (let child of element.children) {
        mapSkewToDash(child);
    }
    if (element.tagName != "path") {
        return;
    }
    let pathLen = new KSPathData(element.getProperty("d")).getTotalLength();
    let staticStart = 0;
    let staticEnd = 1;
    // trim start
    if (element.hasProperty("ks:skewX")) {
        staticStart = +element.getProperty("ks:skewX");
    }
    // trim end
    if (element.hasProperty("stroke-dasharray")) {
        staticEnd = +element.getProperty("stroke-dasharray");
    }
    // remove skew keyframes if they all have the same value to ensure roundtripping of
    // exported line animations (it always writes out trim start animations)
    if (element.timeline().hasKeyframes("ks:skewX")) {
        let value = element.timeline().getKeyframes("ks:skewX")[0].value;
        for (let kf of element.timeline().getKeyframes("ks:skewX")) {
            if (kf.value != value) {
                value = Infinity;
                break;
            }
        }
        if (value != Infinity) {
            removeAllKeyframes(element, "ks:skewX");
        }
    }

    // convert skew and stroke-dasharray animations to dash offset animation

    if (element.timeline().hasKeyframes("ks:skewX")) { // start animation
        let doff = +element.getProperty("stroke-dashoffset");
        removeAllKeyframes(element, "stroke-dashoffset");
        let kfs = element.timeline().getKeyframes("ks:skewX");
        for (let i = kfs.length-1; i >= 0; --i) {
            let kf = kfs[i];
            element.timeline().setKeyframe("stroke-dashoffset", kf.time,
                                           -(+kf.value+doff)*pathLen, kf.easing);
        }
        // set dash array
        removeAllKeyframes(element, "stroke-dasharray");
        element.setProperty("stroke-dasharray", pathLen);

    } else if (element.timeline().hasKeyframes("stroke-dasharray")) { // end animation
        let doff = +element.getProperty("stroke-dashoffset");
        removeAllKeyframes(element, "stroke-dashoffset");
        let kfs = element.timeline().getKeyframes("stroke-dasharray");
        for (let i = kfs.length-1; i >= 0; --i) {
            let kf = kfs[i];
            element.timeline().setKeyframe("stroke-dashoffset", kf.time,
                                           (-kf.value+doff-1)*pathLen, kf.easing);
        }
        // set dash array
        removeAllKeyframes(element, "stroke-dasharray");
        element.setProperty("stroke-dasharray", pathLen);

    } else if (element.timeline().hasKeyframes("stroke-dashoffset")) { // offset animation
        let start = +element.getProperty("ks:skewX");
        for (let kf of element.timeline().getKeyframes("stroke-dashoffset")) {
            element.timeline().setKeyframe("stroke-dashoffset", kf.time,
                                           -(+kf.value+staticStart)*pathLen, kf.easing);
        }
        // set dash array
        removeAllKeyframes(element, "stroke-dasharray");
        let da = Math.ceil((staticEnd - staticStart) * pathLen * 100) / 100; // round to 2 decimals
        element.setProperty("stroke-dasharray", da + " " + (pathLen-da));

    } else { // no animations
        let doff = +element.getProperty("stroke-dashoffset");
        element.setProperty("stroke-dashoffset", -(doff+staticStart)*pathLen);
        // set dash array
        if (staticStart != 0 || staticEnd != 1) {
            removeAllKeyframes(element, "stroke-dasharray");
            let da = Math.ceil((staticEnd - staticStart) * pathLen * 100) / 100; // round to 2 decimals
            element.setProperty("stroke-dasharray", da + " " + (pathLen-da));
        }
    }
    removeAllKeyframes(element, "ks:skewX")
    element.setProperty("ks:skewX", 0);
}

function convertFillRule(rule)
{
    if (rule == "evenOdd") {
        return "evenodd";
    }
    return "nonzero";
}

function reverseValue(val)
{
    return -parseFloat(val);
}

function fixPathData(val)
{
    // this is for bodymoving-to-avd, which may create a bit bad data
    return val.replace("c  M", "z  M");
}

function processRenderable(children)
{
    if (!children || children.length == 0) {
        return;
    }
    let parentElem = elementStack[elementStack.length-1];
    let clipPathGroups = 0;
    for (let child of children) {
        if (child.tagName == "group") {
            let elem = ksdoc.createElement("g");
            copyProperty(child, "android:name", elem, "id");
            copyProperty(child, "android:translateX", elem, "ks:positionX");
            copyProperty(child, "android:translateY", elem, "ks:positionY");

            // pivot X,Y gets special processing
            let pivotX = child.attributes["android:pivotX"] || 0;
            let pivotY = child.attributes["android:pivotY"] || 0;
            if (parseFloat(pivotX) != 0 || parseFloat(pivotY) != 0) {
                // create an extra element for pivot, because pivoting is equal to
                // "translate(px,py) scale rotate translate(-px,-py)"
                copyProperty(child, "android:pivotX", elem, "ks:anchorX");
                copyProperty(child, "android:pivotY", elem, "ks:anchorY");
                let pivotElem = ksdoc.createElement("g");
                if (child.attributes["android:name"]) {
                    let normalId = child.attributes["android:name"];
                    let pivotId = normalId + "_p";
                    pivotElem.setProperty("id", pivotId);
                    pivotElementIds[normalId] = pivotId;
                }
                parentElem.append(elem);
                parentElem = elem;
                elem = pivotElem;
            }

            copyProperty(child, "android:scaleX", elem, "ks:scaleX");
            copyProperty(child, "android:scaleY", elem, "ks:scaleY");
            copyProperty(child, "android:rotation", elem, "ks:rotation");
            copyProperty(child, "android:pivotX", elem, "ks:anchorX", reverseValue);
            copyProperty(child, "android:pivotY", elem, "ks:anchorY", reverseValue);

            parentElem.append(elem);
            elementStack.push(elem);
            processRenderable(child.children);
            elementStack.pop();
            // restore parent element, because pivot element may have changed it
            parentElem = elementStack[elementStack.length-1];

        } else if (child.tagName == "path") {
            let elem = ksdoc.createElement("path");
            copyProperty(child, "android:name", elem, "id");
            copyColor(child, "android:fillColor", elem, "fill");
            copyProperty(child, "android:fillAlpha", elem, "fill-opacity");
            copyColor(child, "android:strokeColor", elem, "stroke");
            copyProperty(child, "android:strokeAlpha", elem, "stroke-opacity");
            // android:strokeWidth="0" is the default and it means 0.5??
            copyProperty(child, "android:strokeWidth", elem, "stroke-width");
            copyProperty(child, "android:strokeLineCap", elem, "stroke-linecap");
            copyProperty(child, "android:strokeLineJoin", elem, "stroke-linejoin");
            copyProperty(child, "android:strokeMiterLimit", elem, "stroke-miterlimit");
            copyProperty(child, "android:fillType", elem, "fill-rule", convertFillRule);
            copyProperty(child, "android:pathData", elem, "d", fixPathData);
            // temporarily copy trim start to skew
            copyProperty(child, "android:trimPathStart", elem, "ks:skewX");
            copyProperty(child, "android:trimPathEnd", elem, "stroke-dasharray");
            copyProperty(child, "android:trimPathOffset", elem, "stroke-dashoffset");
            parentElem.append(elem);

        } else if (child.tagName == "clip-path") {
            // wrap clip-path and elements in a group so that SVG clipPath works correctly
            let group = ksdoc.createElement("g");
            parentElem.append(group);
            elementStack.push(group);
            parentElem = group;
            clipPathGroups += 1;

            let elem = ksdoc.createElement("path");
            copyProperty(child, "android:name", elem, "id");
            elem.setProperty("fill", "#000000"); // create black paths so they can be seen
            copyProperty(child, "android:pathData", elem, "d", fixPathData);
            let clipPath = ksdoc.createElement("clipPath");
            clipPath.append(elem);
            parentElem.append(clipPath);
        }
    }
    for (let i = 0; i < clipPathGroups; ++i) {
        elementStack.pop();
    }
}

let generatedColors = 0x000000;

function androidColorToSvgColor(color, ignoreAlpha)
{
    if (color.startsWith("@") || color.startsWith("?")) {
        generatedColors += 0x404040;
        if (generatedColors > 0xffffff) {
            generatedColors = 0x404040;
        }
        return "#" + generatedColors.toString(16);
    }
    if (!color.startsWith("#")) {
        return "#000000";
    }
    // #rgb or #rrggbb
    if (color.length == 4 || color.length == 7) {
        return color;
    }
    if (color.length > 7 && ignoreAlpha) { // if it is "#aarrggbb", then remove alpha value
        if (color == "#00000000") {
            return "none";
        }
        return "#"+color.substring(3);
    }
    // convert to rgba()
    let val = parseInt(color.substring(1), 16);
    let a = (val >> 24) & 255;
    let r = (val >> 16) & 255;
    let g = (val >> 8) & 255;
    let b = val & 255;
    return "rgba(" + r + ", " + g + ", " + b + ", " + (a/255) + ")";
}

const svgSpreadMap = {
    "clamp": "pad",
    "disabled": "pad",
    "mirror": "reflect",
    "repeat": "repeat"
};

function copyGradient(aaptObj, elem, svgProp)
{
    if (!aaptObj.children) {
        return;
    }
    for (let child of aaptObj.children) {
        if (child.tagName == "gradient") {
            let type = child.attributes["android:type"];

            let color;
            if (type == "radial") {
                let cx = child.attributes["android:centerX"] || 0;
                let cy = child.attributes["android:centerY"] || 0;
                let r = child.attributes["android:gradientRadius"];
                if (!r) {
                    throw "android:gradientRadius missing";
                }
                color = "-ks-radial-gradient(userSpaceOnUse "+r+" "+cx+" "+cy+" "+cx+" "+cy+" ";

            } else { // default linear
                let sx = child.attributes["android:startX"] || 0;
                let sy = child.attributes["android:startY"] || 0;
                let ex = child.attributes["android:endX"] || 0;
                let ey = child.attributes["android:endY"] || 0;
                color = "-ks-linear-gradient(userSpaceOnUse "+sx+" "+sy+" "+ex+" "+ey+" ";
            }
            let tileMode = child.attributes["android:tileMode"] || "clamp";
            let svgSpread = svgSpreadMap[tileMode];
            let stops = readStops(child);
            color += svgSpread + " matrix(1 0 0 1 0 0), " + stops.join(", ")+")";
            elem.setProperty(svgProp, color);
        }
    }
}

function appendStopToArray(array, offset, androidColor)
{
    let color = androidColorToSvgColor(androidColor, false);
    array.push(color+" "+offset);
}

function clamp(val, min, max)
{
    return val < min ? min : val < max ? val : max;
}

function readStops(gradientObj)
{
    let stops = [];
    for (let child of gradientObj.children) {
        if (child.tagName == "item") {
            let color = child.attributes["android:color"] || "#00000000";
            let offset = child.attributes["android:offset"] || 0;
            offset = clamp(offset, 0, 1);
            appendStopToArray(stops, (offset*100)+"%", color);
        }
    }
    if (stops.length > 1) {
        return stops;
    }
    stops = [];
    let startColor = gradientObj.attributes["android:startColor"] || "#00000000";
    let centerColor = gradientObj.attributes["android:centerColor"];
    let endColor = gradientObj.attributes["android:endColor"] || "#00000000";
    appendStopToArray(stops, "0%", startColor);
    if (centerColor) {
        appendStopToArray(stops, "50%", centerColor);
    }
    appendStopToArray(stops, "100%", endColor);
    return stops;
}

function copyColor(obj, androidProp, elem, svgProp)
{
    // fill default value is "none"
    if (svgProp == "fill") {
        elem.setProperty(svgProp, "none");
    }
    // if androidProp and aapt:attr both are given, then it should be an error
    // if child aapt:attr exists for the given color, then parse it
    if (obj.children) {
        for (let child of obj.children) {
            if (child.tagName == "aapt:attr" && child.attributes["name"] == androidProp) {
                copyGradient(child, elem, svgProp);
                return;
            }
        }
    }
    if (!obj.attributes[androidProp]) { // no value means 'none'
        return;
    }
    let color = obj.attributes[androidProp];
    color = androidColorToSvgColor(color, true);
    elem.setProperty(svgProp, color);
}

function copyProperty(obj, androidProp, elem, svgProp, processor)
{
    if (!obj.attributes[androidProp]) {
        return;
    }
    let val = obj.attributes[androidProp];
    if (svgProp == "d" && val.startsWith("@")) {
        val = "M7,5C7,5,4,7,1,7C-2,7,-6,5.5,-6,1C-6,-3.5,-2.5,-6,1,-6C4.5,-6,6,-3.5,6,-1" +
              "C6,1.5,4.5,4,3,4C1.5,4,3.7,-3.5,3.7,-3.5C3.7,-3.5,2,4,-0.6,4C-2.5,4,-3,2.41979,-3,0.5" +
              "C-3,-1.5,-1.5,-3.4,0.5,-3.4C2.5,-3.4,2.7,-1.5,2.7,0";
    }
    if (val.startsWith("@") || val.startsWith("?")) { // skip
        return;
    }
    if (processor) {
        val = processor(val);
    }
    elem.setProperty(svgProp, val);
}

// Animation processing

function processAnimations(rootObj)
{
    for (let child of rootObj.children) {
        if (child.tagName == "target") {
            // check target exists
            let targetId = child.attributes["android:name"] || "";
            let elem = ksdoc.getElementById(targetId);
            if (!elem || child.children.length == 0) {
                continue;
            }
            // check aaptattr exists
            let aaptattr = child.children[0];
            if (aaptattr.tagName != "aapt:attr" ||
                    aaptattr.attributes["name"] != "android:animation") {
                continue;
            }
            if (aaptattr.children.length != 1) {
                throw "<aapt:aatr> must have exactly one child element";
            }
            processAnimatorOrSet(aaptattr.children[0], elem, 0);
        }
    }
}

// recursively process <set> or <objectAnimator> elements
function processAnimatorOrSet(animOrSetObj, elem, beginTime)
{
    if (animOrSetObj.tagName == "set") {
        let isSequence = animOrSetObj.attributes["android:ordering"] == "sequentially";
        let maxDur = 0;
        for (let animator of animOrSetObj.children) {
            let odur = processAnimatorOrSet(animator, elem, beginTime);
            if (isSequence) {
                beginTime += odur;
            }
            if (maxDur < odur) {
                maxDur = odur;
            }
        }
        return isSequence ? beginTime : beginTime + maxDur;

    } else { // try to process it as objectAnimator
        return processObjectAnimator(animOrSetObj, elem, beginTime);
    }
}

function interpolatorToCubic(intpo)
{
    const androidToCubic = {
        "linear":               "linear",
        "linear_out_slow_in":   "cubic-bezier(0, 0, 0.2, 1)",
        "accelerate_quad":      "cubic-bezier(0.35, 0, 0.705, 0.395)",
        "accelerate_cubic":     "cubic-bezier(0.54, 0, 0.685, 0.17)",
        "accelerate_quint":     "cubic-bezier(0.675, 0, 0.77, 0)",
        "accelerate_decelerate":"cubic-bezier(0.375, 0, 0.63, 1)",
        "anticipate":           "cubic-bezier(0.72, -0.30, 0.735, -0.115)",
        "anticipate_overshoot": "cubic-bezier(0.80, -0.675, 0.20, 1.675)",
        "bounce":               "linear",
        "cycle":                "linear",
        "decelerate_quad":      "cubic-bezier(0.28, 0.55, 0.61, 1.0)",
        "decelerate_cubic":     "cubic-bezier(0.295, 0.735, 0.39, 1.0)",
        "decelerate_quint":     "cubic-bezier(0.24, 1.0, 0.31, 1.0)",
        "fast_out_linear_in":   "cubic-bezier(0.4, 0, 1, 1)",
        "fast_out_slow_in":     "cubic-bezier(0.4, 0, 0.2, 1)",
        "overshoot":            "cubic-bezier(0.265, 0.885, 0.19, 1.385)"
    };
    let ai = "linear";
    if (intpo) {
        if (intpo.startsWith("@android:interpolator/")) {
            ai = intpo.substring(22);
        } else if (intpo.startsWith("@android:anim/")) {
            ai = intpo.substring(14);
            ai.replace("_interpolator", "");
        }
    }
    return androidToCubic[ai];
}

// returns undefined if interpolator child element isn't found
function readInterpolatorFromChild(obj)
{
    if (obj.children.length == 0) {
        return;
    }
    for (let child of obj.children) {
        // read only <pathInterpolator> under <aapt:attr>
        if (child.tagName != "aapt:attr" || child.attributes["name"] != "android:interpolator" ||
                child.children == 0) {
            continue;
        }
        let intp = child.children[0];
        if (intp.tagName != "pathInterpolator") {
            // non-supported interpolator, use linear for it
            return "linear";
        }
        let pathData = intp.attributes["android:pathData"];
        let cmds = new KSPathData(pathData).commands;

        // check steps
        if (cmds.length == 3 &&
                cmds[0].command == 'M' && cmds[0].x == 0 && cmds[0].y == 0 &&
                cmds[1].command == 'L' &&
                cmds[2].command == 'L' && cmds[2].x == 1 && cmds[2].y == 1) {
            if (cmds[1].x == 1 && cmds[1].y == 0) {
                return "steps(1)";
            }
            if (cmds[1].x == 0 && cmds[1].y == 1) {
                return "steps(1, start)";
            }
        }

        // check cubic beziers
        let cmd0 = cmds[0].command.toUpperCase();
        let cmd1 = cmds[1].command.toUpperCase();
        if (cmds.length != 2 || cmd0 != 'M' || cmd1 != 'C') {
            // non-supported path, use linear for it
            return "linear";
        }
        if (cmds[0].x != 0 || cmds[0].y != 0) {
            // non-supported path, use linear for it
            return "linear";
        }
        if (cmds[1].x != 1 || cmds[1].y != 1) {
            // non-supported path, use linear for it
            return "linear";
        }
        return "cubic-bezier("+cmds[1].x1+", "+cmds[1].y1+", "+cmds[1].x2+", "+cmds[1].y2+")";
    }
}

const animationPropertyNameToSvgProperty = {
    "translateX":   { svgProp: "ks:positionX", type: "floatType" },
    "translateY":   { svgProp: "ks:positionY", type: "floatType" },
    "rotation":     { svgProp: "ks:rotation", type: "floatType", isPivotElementProperty: true },
    "scaleX":       { svgProp: "ks:scaleX", type: "floatType", isPivotElementProperty: true },
    "scaleY":       { svgProp: "ks:scaleY", type: "floatType", isPivotElementProperty: true },
    "fillColor":    { svgProp: "fill", type: "colorType" },
    "strokeColor":  { svgProp: "stroke", type: "colorType" },
    "strokeWidth":  { svgProp: "stroke-width", type: "floatType" },
    "strokeAlpha":  { svgProp: "stroke-opacity", type: "floatType" },
    "fillAlpha":    { svgProp: "fill-opacity", type: "floatType" },
    "pathData":     { svgProp: "d", type: "pathType" },
    "alpha":        { svgProp: "opacity", type: "floatType" },
    "trimPathStart":{ svgProp: "ks:skewX", type: "floatType" },
    "trimPathEnd":  { svgProp: "stroke-dasharray", type: "floatType" },
    "trimPathOffset":{ svgProp: "stroke-dashoffset", type: "floatType" }
};

function convertValue(svgProp, value)
{
    if (svgProp == "fill" || svgProp == "stroke") {
        value = androidColorToSvgColor(value, true);
    }
    return value;
}

function processObjectAnimator(animator, elem, beginTime)
{
    if (animator.tagName != "objectAnimator") {
        return 0;
    }
    let startOffset = parseFloat(animator.attributes["android:startOffset"] || 0);
    let duration = parseFloat(animator.attributes["android:duration"] || 300);
    if (startOffset < 0) {
        startOffset = 0;
    }
    if (duration < 0) {
        throw "Duration cannot be negative";
    }
    if (duration == 0) { // no real animation, just return
        return startOffset;
    }
    let interpolator = animator.attributes["android:interpolator"] || "accelerate_decelerate";
    let repeatCount = animator.attributes["android:repeatCount"];

    let hasPropertyValuesHolder = false;
    for (let propValHolder of animator.children) {
        if (propValHolder.tagName == "propertyValuesHolder") {
            processPropertyValueHolder(propValHolder, elem, beginTime,
                startOffset, duration, interpolator, repeatCount);
            hasPropertyValuesHolder = true;
        }
    }
    if (!hasPropertyValuesHolder) { // children are propertyValuesHolders?
        // process objectAnimator as a "propertyValueHolder"
        processPropertyValueHolder(animator, elem, beginTime,
            startOffset, duration, interpolator, repeatCount);
    }
    return startOffset + duration;
}

function processPropertyValueHolder(obj, elem, beginTime, startOffset, duration, interpolator,
                                    repeatCount)
{
    let propertyName = obj.attributes["android:propertyName"];
    let valueType_unused = obj.attributes["android:valueType"];
    if (!propertyName || !animationPropertyNameToSvgProperty[propertyName]) {
        return;
    }
    if (propertyName == "alpha" && elem.parentElement) { // only root can have alpha animations
        return;
    }

    let pivotId = pivotElementIds[elem.getProperty("id")];
    if (pivotId && animationPropertyNameToSvgProperty[propertyName].isPivotElementProperty) {
        elem = ksdoc.getElementById(pivotId);
    }

    let svgProp = animationPropertyNameToSvgProperty[propertyName].svgProp;
    elem.timeline().setSeparated(svgProp, true); // all props are separated
    let easing = interpolatorToCubic(interpolator);
    let easingChild = readInterpolatorFromChild(obj);
    if (easingChild) {
        easing = easingChild;
    }

    // if the property already has keyframes, then remove repeat and don't allow
    // any further repeats, because adding keyframes over old keyframes doesn't work with repeating
    if (elem.timeline().hasKeyframes(svgProp)) {
        elem.timeline().setKeyframeParams(svgProp, { repeatEnd: 0 });
        repeatCount = 0;
    }

    removeKeyframes(elem, svgProp, beginTime+startOffset, beginTime+startOffset+duration);

    if (obj.tagName == "propertyValuesHolder") {
        if (processKeyframes(obj, elem, beginTime, startOffset, duration, interpolator,
                             svgProp, easing)) {
            setRepeat(elem, svgProp, beginTime, startOffset, duration, repeatCount);
            return; // if keyframes were found, then don't process valueFrom..valueTo
        }
    }

    let valueFrom = obj.attributes["android:valueFrom"];
    let valueTo = obj.attributes["android:valueTo"];

    elem.timeline().setKeyframe(svgProp, beginTime+startOffset+duration,
                                convertValue(svgProp, valueTo));
    elem.timeline().setKeyframe(svgProp, beginTime+startOffset,
                                convertValue(svgProp, valueFrom), easing);
    setRepeat(elem, svgProp, beginTime, startOffset, duration, repeatCount);
}

function processKeyframes(obj, elem, beginTime, startOffset, duration, interpolator,
                          svgProp, easing)
{
    let foundKeyframes = false;
    for (let keyframe of obj.children) {
        if (keyframe.tagName == "keyframe") {
            foundKeyframes = true;
            let fraction = keyframe.attributes["android:fraction"];
            let value = keyframe.attributes["android:value"];
            if (!fraction || !value) {
                continue;
            }
            // TODO: keyframe can have an interpolator
            elem.timeline().setKeyframe(svgProp, beginTime+startOffset+fraction*duration,
                                        convertValue(svgProp, value), "linear");
        }
    }
    return foundKeyframes;
}

// removes keyframes between the given times (excluding the given times)
function removeKeyframes(elem, svgProp, startTime, endTime)
{
    let kfs = elem.timeline().getKeyframes(svgProp);
    for (let kf of kfs) {
        if (startTime < kf.time && kf.time < endTime) {
            elem.timeline().removeKeyframe(svgProp, kf.time);
        }
    }
}

function setRepeat(elem, svgProp, beginTime, startOffset, duration, repeatCount)
{
    if (!repeatCount) {
        return;
    }
    if (repeatCount == "infinite" || repeatCount == -1) {
        elem.timeline().setKeyframeParams(svgProp, { repeatEnd: Infinity });
        return;
    }
    repeatCount = parseFloat(repeatCount);
    if (repeatCount != Math.floor(repeatCount)) {
        throw "Fractions are not allowed for repeatCount: "+repeatCount;
    }
    if (repeatCount < 1) { // this includes negative values (they should really disable animation)
        return;
    }
    let end = beginTime + startOffset + duration * (repeatCount+1);
    elem.timeline().setKeyframeParams(svgProp, { repeatEnd: end });
}

// combines separated properties if they can be combined
function simplifyAnimations(element)
{
    // process the element tree recursively
    for (let child of element.children) {
        simplifyAnimations(child);
    }
    unseparateKeyframes(element, "ks:positionX", "ks:positionY");
    unseparateKeyframes(element, "ks:scaleX", "ks:scaleY");
}

function unseparateKeyframes(element, propX, propY)
{
    if (!element.timeline().hasKeyframes(propX) || !element.timeline().hasKeyframes(propY)) {
        return;
    }
    // must have the same repeatEnd, keyframe count, times and easings
    let paramsX = element.timeline().getKeyframeParams(propX);
    let paramsY = element.timeline().getKeyframeParams(propY);
    if (paramsX.repeatEnd != paramsY.repeatEnd) {
        return;
    }
    let kfsX = element.timeline().getKeyframes(propX);
    let kfsY = element.timeline().getKeyframes(propY);
    if (kfsX.length != kfsY.length) {
        return;
    }
    for (let i = 0; i < kfsX.length; ++i) {
        let kfx = kfsX[i];
        let kfy = kfsY[i];
        if (kfx.time != kfy.time || kfx.easing != kfy.easing) {
            return;
        }
    }
    element.timeline().setSeparated(propX, false);
}
