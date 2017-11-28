
// Keyshape Exporter for Animated Vector Drawables and Vector Drawables

// returns filenames which will be written by the export function
function getFilenames(userSelectedFileUrl)
{
    return [ userSelectedFileUrl ];
}

// Writes XML to a file
// the objects in the object tree must have tagName, attributes and children keys
class XmlWriter {

    constructor() {
        this.xmlstr = "";
        this.indent = 0;
    }

    _currentIndentString()
    {
        const IndentSpaces = 4;
        return "                                ".substring(0, this.indent * IndentSpaces);
    }

    startTag(tagName, attributes, selfClosing)
    {
        let istr = this._currentIndentString();
        this.xmlstr += istr;
        this.xmlstr += "<"+tagName;
        if (attributes && Object.keys(attributes).length > 0) {
            let list = [];
            for (let attr in attributes) {
                list.push(attr+'="'+attributes[attr]+'"');
            }
            this.xmlstr = this.xmlstr + "\n    " + istr + list.join("\n    "+istr);
        }
        if (selfClosing) {
            this.xmlstr += "/>\n";
        } else {
            this.xmlstr += ">\n";
            ++this.indent;
        }
    }

    endTag(tagName)
    {
        --this.indent;
        let istr = this._currentIndentString();
        this.xmlstr += istr;
        this.xmlstr += "</"+tagName+">\n";
    }

    fromObjects(objs)
    {
        if (!objs.children || objs.children.length == 0) {
            this.startTag(objs.tagName, objs.attributes, true);
        } else {
            this.startTag(objs.tagName, objs.attributes, false);
            for (let child of objs.children) {
                this.fromObjects(child);
            }
            this.endTag(objs.tagName);
        }
    }
    static stringify(objs)
    {
        let x = new XmlWriter();
        x.fromObjects(objs);
        return x.xmlstr;
    }
}

function hasAvdAnimatableKeyframes(element)
{
    for (let svgProp of element.timeline().getKeyframeNames()) {
        // only root element can animate opacity
        if (svgProp == "opacity" && element != app.activeDocument.documentElement) {
            return false;
        }
        if (animatableSvgToAndroidProperties[svgProp]) {
            return true;
        }
    }
    return false;
}

function copyProperty(element, svgProp, obj, targetAttr, avdDefaultValue, converterCallback,
                      converterParam)
{
    let value = element.getProperty(svgProp);
    if (converterCallback) {
        value = converterCallback(value, converterParam);
    }
    if (value != avdDefaultValue) {
        obj.attributes[targetAttr] = value;
    }
}

let generatedIdNumber = 0;

function copyId(element, obj, suffix)
{
    if (!hasAvdAnimatableKeyframes(element)) {
        return;
    }
    let id = element.getProperty("id") || element.androidId;

    // generate id for elements which don't have it
    if (!id) {
        generatedIdNumber++;
        id = "a" + generatedIdNumber;
        // check generated id doesn't exist in document
        while (app.activeDocument.getElementById(id)) {
            id = "a" + generatedIdNumber;
            generatedIdNumber++;
        }
    }
    // store id / generated id to element so that animator objects get the same id
    if (!element.androidId) {
        element.androidId = id;
    }

    // copy id with suffix to obj
    obj.attributes["android:name"] = id + suffix;
}

// copies transform properties, returns an element, which can have children appended to it
function copyTransformProperties(obj, element)
{
    // ks:skewX and ks:skewY are ignored because AVD doesn't support skewing
    copyId(element, obj, "_t");
    copyProperty(element, "ks:positionX", obj, "android:translateX", "0");
    copyProperty(element, "ks:positionY", obj, "android:translateY", "0");
    copyProperty(element, "ks:rotate", obj, "android:rotation", "0");
    copyProperty(element, "ks:scaleX", obj, "android:scaleX", "1");
    copyProperty(element, "ks:scaleY", obj, "android:scaleY", "1");

    // Anchor x and y require one extra group with translate, because pivotXY doesn't
    // work correctly. Children must be added under this extra group.
    let ax = element.getProperty("ks:anchorX");
    let ay = element.getProperty("ks:anchorY");
    console.log("STATIC AXY "+ax+" "+ay);
    if (ax != 0 || ay != 0 || element.timeline().hasKeyframes("ks:anchorX") ||
            element.timeline().hasKeyframes("ks:anchorY")) {
        let aobj = {};
        aobj.attributes = {};
        aobj.tagName = "group";
        aobj.children = [];
        obj.children = [ aobj ];

        copyId(element, aobj, "_a");
        copyProperty(element, "ks:anchorX", aobj, "android:translateX", "0");
        copyProperty(element, "ks:anchorY", aobj, "android:translateY", "0");
        return aobj;
    }
    return obj;
}

const spreadToTileMode = {
    "pad": "clamp",
    "reflect": "mirror",
    "repeat": "repeat"
}

// converts 0...1 to two digit hex value 00...ff
function toHex(colorComponent)
{
    let val = Math.round(colorComponent * 255);
    return ("00"+val.toString(16)).slice(-2);
}

// converts obj.red/green/blue/alpha to #aarrggbb or #rrggbb
function rgbaToAndroidColor(obj)
{
    console.log("GOT COLOR: "+JSON.stringify(obj));
    if ((typeof obj.alpha == "undefined") || obj.alpha == 1) {
        return "#" + toHex(obj.red) + toHex(obj.green) + toHex(obj.blue);
    }
    return "#" + toHex(obj.alpha) + toHex(obj.red) + toHex(obj.green) + toHex(obj.blue);
}

function copyColor(element, svgProp, obj, targetAttr)
{
    let value = element.getProperty(svgProp);
    let color = app.util.parseColor(value);
    if (color.type == "color") {
        obj.attributes[targetAttr] = rgbaToAndroidColor(color);

    } else if (color.type == "linear-gradient" || color.type == "radial-gradient") {
        // gradient requires API 24+
        if (color.stops.length == 0) { // no stops
            return;
        }
        if (color.stops.length == 1) { // one stop is a solid color
            obj.attributes[targetAttr] = rgbaToAndroidColor(color.stops[0]);
            return;
        }
        let gattrs;
        if (color.type == "linear-gradient") {
            gattrs = {
                "android:type": "linear",
                "android:startX": color.x1,
                "android:startY": color.y1,
                "android:endX": color.x2,
                "android:endY": color.y2
            };
        } else { // radial-gradient
            gattrs = {
                "android:type": "radial",
                "android:centerX": color.cx,
                "android:centerY": color.cy,
                "android:gradientRadius": color.r
            };
        }
        let gr = {
            tagName: "gradient",
            attributes: gattrs
        };
        gr.attributes["android:tileMode"] = spreadToTileMode[color.spreadMethod];
        // first stop
        gr.attributes["android:startColor"] = rgbaToAndroidColor(color.stops[0]);
        // optional mid stop
        if (color.stops.length > 2) {
            let mid = Math.floor(color.stops.length/2);
            gr.attributes["android:centerColor"] = rgbaToAndroidColor(color.stops[mid]);
        }
        // last stop
        gr.attributes["android:endColor"] =
                rgbaToAndroidColor(color.stops[color.stops.length-1]);

        let aaptattr = {
            tagName: "aapt:attr",
            attributes: { "name": targetAttr },
            children: [ gr ]
        };
        if (!obj.children) {
            obj.children = [];
        }
        console.log("-------- GOT: "+JSON.stringify(aaptattr));
        obj.children.push(aaptattr);
    }
    // none is not set at all
}

function convertFillRule(value)
{
    if (value == "evenodd") {
        return "evenOdd";
    }
    return "nonZero";
}

function copyPathProperties(element, obj)
{
    copyId(element, obj, "_p");
    copyColor(element, "fill", obj, "android:fillColor");
    copyColor(element, "stroke", obj, "android:strokeColor");
    copyProperty(element, "stroke-width", obj, "android:strokeWidth", "0");
    copyProperty(element, "stroke-opacity", obj, "android:strokeAlpha", "1");
    copyProperty(element, "fill-opacity", obj, "android:fillAlpha", "1");
    copyProperty(element, "stroke-linecap", obj, "android:strokeLineCap", "butt");
    copyProperty(element, "stroke-linejoin", obj, "android:strokeLineJoin", "miter");
    copyProperty(element, "stroke-miterlimit", obj, "android:strokeMiterLimit", "4");
    copyProperty(element, "fill-rule", obj, "android:fillType", "nonZero", convertFillRule);
    copyProperty(element, "d", obj, "android:pathData", "");
}

let numberOfPaths = 0;

// converts element and all its children to objs
function convertElement(element)
{
    let tagName = element.tagName;

    let obj = {};
    let gobj = obj;
    obj.attributes = {};

    if (tagName == "path") {
        numberOfPaths++;
        let objpath = {};
        objpath.tagName = "path";
        objpath.attributes = {};
        copyPathProperties(element, objpath);
        obj.tagName = "group";
        gobj = copyTransformProperties(obj, element);
        gobj.children = [ objpath ];
        return obj;
    }

    if (tagName == "g" || tagName == "svg") {
        obj.tagName = "group";
        gobj = copyTransformProperties(obj, element);
        gobj.children = [];
        for (let child of element.children) {
            // skip elements which have display="none"
            if (child.getProperty("display") == "none") {
                continue;
            }
            if (child.tagName == "g" || child.tagName == "path") {
                gobj.children.push(convertElement(child));
            }
        }
    }
    return obj;
}

function convertToPaths(doc, element)
{
    // convert the element tree recursively to paths
    for (let child of element.children) {
        convertToPaths(doc, child);
    }
    // select element to be converted to path and convert it
    // (only converts elements which can be converted)
    doc.selectedElements = [ element ];
    doc.cmd.convertToPath();
}

function detachFromSymbols(doc, element)
{
    // convert the element tree recursively to paths
    for (let child of element.children) {
        detachFromSymbols(doc, child);
    }
    // select element to be converted to path and convert it
    // (only converts elements which can be converted)
    doc.selectedElements = [ element ];
    doc.cmd.detachFromSymbol();
}


function createVectorDrawable(root, withNamespace)
{
    let objs = convertElement(root);

    if (numberOfPaths == 0) {
        throw "There must be at least one visible path.";
    }

    // set up vector element
    objs.tagName = "vector";
    let viewBox = root.getProperty("viewBox");
    if (!viewBox) viewBox = "0 0 16 16";
    let viewValues = viewBox.split(" ");
    let width = viewValues[2];
    let height = viewValues[3];
    objs.attributes = {};
    if (withNamespace) {
        objs.attributes["xmlns:android"] = "http://schemas.android.com/apk/res/android";
        objs.attributes["xmlns:aapt"] = "http://schemas.android.com/aapt"; // for gradients
    }
    objs.attributes["android:width"] = width+"dp";
    objs.attributes["android:height"] = height+"dp";
    objs.attributes["android:viewportWidth"] = width;
    objs.attributes["android:viewportHeight"] = height;
    copyProperty(root, "opacity", objs, "android:alpha", "1");
    copyId(root, objs, "_o");
    return objs;
}

// main function to export vector drawable
function exportVD(userSelectedFileUrl)
{
    let root = app.activeDocument.documentElement;

    // detach symbols from use elements
    detachFromSymbols(app.activeDocument, root);

    // convert rects, ellipses and text to paths
    convertToPaths(app.activeDocument, root);

    // create an object tree for a vector drawable
    let vd = createVectorDrawable(root, true);

    // convert object tree to xml and write to a file
    app.fs.writeFileSync(userSelectedFileUrl, XmlWriter.stringify(vd));
}

// ks:skewX/Y is not included because AVD doesn't support skewing
const animatableSvgToAndroidProperties = {
    "ks:positionX":     { idsuffix: "_t", prop: "translateX", type: "floatType" },
    "ks:positionY":     { idsuffix: "_t", prop: "translateY", type: "floatType" },
    "ks:rotate":        { idsuffix: "_t", prop: "rotation", type: "floatType" },
    "ks:scaleX":        { idsuffix: "_t", prop: "scaleX", type: "floatType" },
    "ks:scaleY":        { idsuffix: "_t", prop: "scaleY", type: "floatType" },
    "ks:anchorX":       { idsuffix: "_a", prop: "translateX", type: "floatType" },
    "ks:anchorY":       { idsuffix: "_a", prop: "translateY", type: "floatType" },
    "fill":             { idsuffix: "_p", prop: "fillColor" },
    "stroke":           { idsuffix: "_p", prop: "strokeColor" },
    "stroke-width":     { idsuffix: "_p", prop: "strokeWidth", type: "floatType" },
    "stroke-opacity":   { idsuffix: "_p", prop: "strokeAlpha", type: "floatType" },
    "fill-opacity":     { idsuffix: "_p", prop: "fillAlpha", type: "floatType" },
    "d":                { idsuffix: "_p", prop: "pathData", type: "pathType" },
    // opacity is only for the root element
    "opacity":          { idsuffix: "_o", prop: "alpha", type: "floatType" }
};

function addRepeatCount(objectAnimator, begin, dur, repeatEnd)
{
    if (repeatEnd) {
        if (repeatEnd == Infinity) {
            objectAnimator.attributes["android:repeatCount"] = "infinite";
        } else {
            // 0=play only once, 1=play the animation twice, fractions are not allowed
            objectAnimator.attributes["android:repeatCount"] = Math.round((repeatEnd-begin) / dur)-1;
        }
    }
}

function addInterpolator(objectAnimator, easing)
{
    // linear
    if (!easing || easing == "linear") {
        objectAnimator.attributes["android:interpolator"] = "@android:interpolator/linear";
        return;
    }
    // cubic-bezier
    let pipo;
    if (easing.startsWith("cubic-bezier(")) {
        let ctrls = easing.match(/cubic-bezier\(([- 0-9.]+),([- 0-9.]+),([- 0-9.]+),([- 0-9.]+)\)/);
        pipo = {
            tagName: "pathInterpolator",
            attributes: { "android:pathData":
                          "M0,0 C"+ctrls[1]+","+ctrls[2]+" "+ctrls[3]+","+ctrls[4]+" 1,1" }
        }
    }
    // steps
    if (easing.startsWith("steps(")) {
        if (easing.indexOf("start") > 0) {
            pipo = {
                tagName: "pathInterpolator",
                attributes: { "android:pathData": "M0,0 L0,1 1,1" }
            }
        } else { // steps-end
            pipo = {
                tagName: "pathInterpolator",
                attributes: { "android:pathData": "M0,0 L1,0 1,1" }
            }
        }
    }
    let aaptattr = {
        tagName: "aapt:attr",
        attributes: { "name": "android:interpolator" },
        children: [ pipo ]
    };
    objectAnimator.children = [ aaptattr ];
}

function createObjectAnimators(element, svgProp, androidProp, kfs, params)
{
    let animators = [];
    for (let i = 0; i < kfs.length-1; i++) {
        // check colors are solids and nothing else
        let fromkf = kfs[i];
        let tokf = kfs[i+1];
        if (svgProp == "fill" || svgProp == "stroke") {
            if (!fromkf.value.startsWith("#") || !tokf.value.startsWith("#")) {
                let id = element.getProperty("id");
                if (id) {
                    id = "'" + id + "'";
                } else {
                    id = "unknown-id";
                }
                throw "Only solid colors can be animated, element: "+id+" property: '"+svgProp+"'";
            }
        }
        let dur = tokf.time - fromkf.time;
        // path animation may contain zero duration animations if subpath count changes
        // there is no need to export them
        if (dur == 0) {
            continue;
        }
        // keyframes at zero time to reset values can have zero duration
        if (fromkf.zeroReset) {
            dur = 0;
        }
        let oattrs = {
            "android:propertyName": androidProp,
            "android:duration": dur,
            "android:valueFrom": fromkf.value,
            "android:valueTo": tokf.value
        };
        if (fromkf.time > 0) {
            oattrs["android:startOffset"] = fromkf.time;
        }
        let androidType = animatableSvgToAndroidProperties[svgProp].type;
        if (androidType) { // colors don't have valueType
            oattrs["android:valueType"] = androidType;
        }
        let objectAnimator = {
            tagName: "objectAnimator",
            attributes: oattrs
        };
        if (kfs.length == 2) { // add repeat only for 2 keyframes
            addRepeatCount(objectAnimator, fromkf.time, tokf.time - fromkf.time, params.repeatEnd);
        }
        addInterpolator(objectAnimator, fromkf.easing);
        animators.push(objectAnimator);
    }
    return animators;
}

function createAnimations(element, targets)
{
    // create animated properties

    let objectAnimators = {};
    for (let svgProp of element.timeline().getKeyframeNames()) {
        // skip unknown property animations
        if (!animatableSvgToAndroidProperties[svgProp]) {
            continue;
        }
        // only root element can animate opacity
        if (svgProp == "opacity" && element != app.activeDocument.documentElement) {
            continue;
        }
        let androidProp = animatableSvgToAndroidProperties[svgProp].prop;
        let kfs = element.timeline().getKeyframes(svgProp);
        if (kfs.length < 2) { // only one keyframe given, it doesn't need to be processed
            continue;
        }
        if (svgProp == "d") {
            kfs = app.util.makePathDataKeyframesInterpolatable(kfs);
        }
        if (kfs[0].time > 0) {
            // always needs time 0 so that properties are reset to their initial values in repeat
            let kfzero = { time: 0, value: kfs[0].value, zeroReset: true };
            kfs.unshift(kfzero);
        }
        let idsuf = animatableSvgToAndroidProperties[svgProp].idsuffix;
        if (!objectAnimators[idsuf]) {
            objectAnimators[idsuf] = [];
        }
        let params = element.timeline().getKeyframeParams(svgProp);
        let anims = createObjectAnimators(element, svgProp, androidProp, kfs, params);
        objectAnimators[idsuf].push(...anims); // append array to another
    }

    // create targets
    for (let idsuf in objectAnimators) {
        let objAnims = objectAnimators[idsuf];
        let aaptattr = {
            tagName: "aapt:attr",
            attributes: { "name": "android:animation" }
        };
        if (objAnims.length > 1) {
            let set = {
                tagName: "set",
                children: objAnims
            };
            aaptattr.children = [ set ];
        } else {
            aaptattr.children = [ objAnims[0] ];
        }
        // target id is the real/generated id + suffix
        let id = element.androidId + idsuf;
        let target = {
            tagName: "target",
            attributes: { "android:name": id }
        };
        target.children = [ aaptattr ];
        targets.push(target);
    }

    // recursively process children
    if (element.tagName == "g" || element.tagName == "svg") {
        for (let child of element.children) {
            // skip elements which have display="none"
            if (child.getProperty("display") == "none") {
                continue;
            }
            if (child.tagName == "g" || child.tagName == "path") {
                createAnimations(child, targets);
            }
        }
    }
}

// main function to export animated vector drawable
function exportAnimatedVD(userSelectedFileUrl)
{
    let root = app.activeDocument.documentElement;

    app.util.renameDuplicateIds();

    // detach symbols from use elements
    detachFromSymbols(app.activeDocument, root);

    // convert rects, ellipses and text to paths
    convertToPaths(app.activeDocument, root);

    // create an object tree for a vector drawable
    let vd = createVectorDrawable(root, false);

    // avd root element
    let avd = { tagName: "animated-vector" };
    avd.attributes = {
        "xmlns:android": "http://schemas.android.com/apk/res/android",
        "xmlns:aapt": "http://schemas.android.com/aapt"
    };
    // wrap vector drawable in aapt:attr
    let aaptattr = {
        tagName: "aapt:attr",
        attributes: { "name": "android:drawable" }
    };
    aaptattr.children = [ vd ];
    avd.children = [ aaptattr ];

    // add animations to avd.children
    createAnimations(root, avd.children);

    // convert object tree to xml and write to a file
    app.fs.writeFileSync(userSelectedFileUrl, XmlWriter.stringify(avd));
}
