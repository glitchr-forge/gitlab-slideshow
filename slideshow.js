$.fn.serializeObject = function() {
    var o = {};
    var a = this.serializeArray();
    $.each(a, function() {
        if (o[this.name]) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
        } else {
            o[this.name] = this.value || '';
        }
    });
    return o;
};

;(function (root, factory) {

    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.Slideshow = factory();
    }

})(this, function () {

    var Slideshow = {};
        Slideshow.version = '0.1.0';

    var Dict = Slideshow.dict = {};
    var Instance = Slideshow.instance = undefined;
    var Settings = Slideshow.settings = {
        selector: ".slideshow",
        timeout: 5000, // default timeout
        autoplay:true,
        max: -1,
        tick:250
    };

    const State = Slideshow.state = {
        PLAY: "play",
        REWIND: "fast-backward",
        ACTIVE: "active",
        TIMEOUT: "timeout",

        FASTBACKWARD: "fast-backward",
        BACKWARD: "backward",
        FORWARD: "forward",
        FASTFORWARD: "fast-forward",
    };

    var debug = true;
    var ready = false;

    Slideshow.get = function(key) {
    
        if(key in Slideshow.settings) 
            return Slideshow.settings[key];

        return null;
    };

    Slideshow.set = function(key, value) {
    
        Slideshow.settings[key] = value;
        return this;
    };

    Slideshow.add = function(key, value) {
    
        if(! (key in Slideshow.settings))
            Slideshow.settings[key] = [];

        if (Slideshow.settings[key].indexOf(value) === -1)
            Slideshow.settings[key].push(value);

        return this;
    };

    Slideshow.remove = function(key, value) {
    
        if(key in Slideshow.settings) {
        
            Slideshow.settings[key] = Slideshow.settings[key].filter(function(setting, index, arr){ 
                return value != setting;
            });

            return Slideshow.settings[key];
        }
        
        return null;
    };

    Slideshow.configure = function (options) {

        var key, value;
        for (key in options) {
            value = options[key];
            if (value !== undefined && options.hasOwnProperty(key)) Settings[key] = value;
        }

        if(debug) console.log("Slideshow configuration: ", Settings);

        return this;
    };

    Slideshow.isReady = function() { return ready; }

    Slideshow.uuidv4 = function() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    };

    Slideshow.ready = function (options = {}) {

        if("debug" in options)
            debug = options["debug"];

        Slideshow.configure(options);
        ready = true;

        if(debug) console.log("Slideshow is ready.");
        dispatchEvent(new Event('Slideshow:ready'));

        Slideshow.run(function() {
            if (Slideshow.get("autoplay")) 
                Slideshow.play();
        });

        return this;
    };

    Slideshow.onLoad = function(selector = Slideshow.get("selector")) {

        $(selector).each(function() {

            this.id = this.id || Slideshow.uuidv4();
            Slideshow.dict[this.id] = {container: this, instance: undefined, first:undefined, last:undefined, progress:0, timeout: undefined};

            Slideshow.run(function() {
                if (Slideshow.get("autoplay")) 
                    Slideshow.play(this);
            }.bind(this));
        });

        if(debug) {
            
            var slideshows = Slideshow.length(selector);
            if (slideshows.length < 1) console.log("Slideshow: no slideshow found");
            else {

                console.log("Slideshow: " + slideshows.length + " slideshow(s) found");
                $(slideshows).each(function(index) { console.log("- Slider #"+(index+1)+" ("+ this + " image(s) found)", $(selector)[index] ); });
            }
        }
    }

    Slideshow.call = function(entry, that = undefined /*  */) {

        if(!$(entry).hasClass("slideshow-entry")) {
            console.error("Failed to load entry..", entry, " no class \"slideshow-entry\" found");
            return undefined;
        }

        var image = $(entry).find(".slideshow-image")[0] || undefined;
        if (image !== undefined) return entry;
        
        image = document.createElement("img");
        image.setAttribute("class", "slideshow-image");
        image.setAttribute("src", $(entry).data("image"));
        
        var href  = $(entry).data("href") || undefined;
        if (href === undefined) entry.prepend(image);
        else {

            var link = document.createElement("a");
                link.append(image);
                link.setAttribute("href", href);
                link.setAttribute("class", "slideshow-link");

            entry.prepend(link);
        }

        //
        // OPTIONAL: Compute pagers
        //
        var pager = $(that).find(".slideshow-pager");
        var page = pager.map(function() { return new DOMParser().parseFromString($(this).data("prototype"), "text/xml").firstChild; });
        
        var thumbnail = $(entry).data("image").replace(/(\.[\w\d_-]+)$/i, '_thumbnail$1');
        $(pager).each(function(i) {

            var that = page[i];
            if(!$(this).hasClass("slideshow-page") && $(this).find(".slideshow-page").length < 1)
                $(this).addClass("slideshow-page");

            $(that).find(".slideshow-thumbnail").each(function() { this.setAttribute("src", thumbnail); });

            $(this).append(that);
        });

        return entry;
    }
    
    Slideshow.asleep = function() {

        var asleep = true;
        Object.keys(Slideshow.dict).forEach(function(id) {
            asleep &= !$(Slideshow.dict[id].container).hasClass(Slideshow.state.PLAY) && !$(Slideshow.dict[id].container).hasClass(Slideshow.state.TIMEOUT) 
        });

        return asleep;
    }

    Slideshow.run = function(callback = function() {}) {

        if(!Slideshow.isReady()) return;

        Slideshow.update();
        callback();

        if (Slideshow.instance !== undefined) return;
        if(debug > 1) console.log("[MASTER]","New call");

        Slideshow.instance = setInterval(function() {

            if(debug > 1) console.log("[MASTER]","Next iteration");
            Object.keys(Slideshow.dict).forEach(function(id) { 

                var that = Slideshow.dict[id];
                if ($(that.container).hasClass(Slideshow.state.PLAY)) {

                    Slideshow.updateProgress(that.container);

                    if (that.interval === undefined) {

                        if(debug > 1) console.log("[SLAVE] ","New call",id);
                        Slideshow.handleNavigation(that.container);
                        $(that.container).removeClass(Slideshow.state.TIMEOUT)

                        that.interval = setInterval(
                            function() { 
                                if(debug > 1) console.log("[SLAVE] ","Next iteration",id);
                                Slideshow.update(that.container); 
                            }.bind(that), that.timeout || Slideshow.get("timeout")
                        );

                    } else if ($(that.container).hasClass(Slideshow.state.TIMEOUT)) {

                        if(debug > 1) console.log("[SLAVE] ","Reset",id);
                        clearInterval(that.interval);
                        that.interval = undefined;
                    }

                } else if (that.interval !== undefined) {

                    if(debug > 1) console.log("[SLAVE] ","Fullstop",id);
                    clearInterval(that.interval);
                    that.interval = undefined;
                }
            });

            if(Slideshow.asleep() && Slideshow.instance != undefined) {

                if(debug) console.log("[MASTER]","Fullstop");
                clearInterval(Slideshow.instance);
                Slideshow.instance = undefined;
            }

        }, Slideshow.get("tick"));
    }

    Slideshow.handleNavigation = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() { 

            var that = this;
            $(this).find(".slideshow-fast-backward").off("click");
            $(this).find(".slideshow-fast-backward").on("click", function() {
                Slideshow.fastBackward(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-backward").off("click");
            $(this).find(".slideshow-backward").on("click", function() {
                Slideshow.backward(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-pause").off("click");
            $(this).find(".slideshow-pause").on("click", function() {
                Slideshow.pause(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-play").off("click");
            $(this).find(".slideshow-play").on("click", function() {
                Slideshow.play(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-stop").off("click");
            $(this).find(".slideshow-stop").on("click", function() {
                Slideshow.pause(that.container);
                Slideshow.fastBackward(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-forward").off("click");
            $(this).find(".slideshow-forward").on("click", function() {
                Slideshow.forward(that.container);
                Slideshow.run();
            });
            $(this).find(".slideshow-fast-forward").off("click");
            $(this).find(".slideshow-fast-forward").on("click", function() {
                Slideshow.fastForward(that.container);
                Slideshow.run();
            });
        });
    }

    Slideshow.updateProgress = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() { 

            if(!$(this).hasClass(Slideshow.state.PLAY)) return;

            //
            // Update progress value
            //
            var tick = Slideshow.get("tick");
            var timeout = Slideshow.dict[this.id].timeout || Slideshow.get("timeout");
            var dP = tick/timeout;

            Slideshow.dict[this.id].progress += dP;
            if (Slideshow.dict[this.id].progress > 1)
                Slideshow.dict[this.id].progress = 1;

            //
            // Optional: update progress bars
            //
            var percentage = Slideshow.dict[this.id].progress;
            $($(this).find(".slideshow-progress")).not(".slideshow-pager .slideshow-progress").each(function() { 
                $(this).data("percentage", percentage);
            });
            $(this).find(".slideshow-pager .slideshow-page.active .slideshow-progress").each(function() { 
                $(this).data("percentage", percentage);
            });
        });
    }

    Slideshow.modulo = function mod(n, m) { return ((n % m) + m) % m; }

    Slideshow.updatePosition = function(selector = Slideshow.get("selector"))
    {
        //
        // Update slideshow position
        //
        return $(Slideshow.find(selector)).map(function() { 

            if (Slideshow.dict[this.id].first === undefined) 
                Slideshow.dict[this.id].first = $(this).data("first") || 0;
            if (Slideshow.dict[this.id].last === undefined) 
                Slideshow.dict[this.id].last = $(this).find(".slideshow-entry").length - 1;

            var position = previousPosition = $(this).data("position");
            var firstPosition = Slideshow.dict[this.id].first;
            var lastPosition  = Slideshow.dict[this.id].last;
            
            if($(this).hasClass(Slideshow.state.REWIND)) 
                position = (position == firstPosition ? lastPosition : firstPosition);
            else if($(this).hasClass(Slideshow.state.FASTFORWARD)) 
                position = (position == lastPosition ? firstPosition : lastPosition);
            else if($(this).hasClass(Slideshow.state.BACKWARD)) 
                position--;
            else if($(this).hasClass(Slideshow.state.FORWARD)) 
                position++;
            else if($(this).hasClass(Slideshow.state.PLAY)) 
                position++;

            $(this).removeClass(Slideshow.state.FASTBACKWARD);
            $(this).removeClass(Slideshow.state.BACKWARD);
            $(this).removeClass(Slideshow.state.FORWARD);
            $(this).removeClass(Slideshow.state.FASTFORWARD);

            var lastPosition = Slideshow.dict[this.id].last;
            if (position < 0 || position > lastPosition) position = Slideshow.modulo(position, lastPosition+1);

            $(this).data("position", position);
            if(position != previousPosition)
                Slideshow.dict[this.id].progress = 0;
        });
    }

    Slideshow.update = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() { 

            // Update position if required
            Slideshow.updatePosition(this);

            //
            // Preload all images..
            //
            var entries = $(this).find(".slideshow-entry");
                entries.each(function(index, entry) {

                    var maxImages = Slideshow.get("max");
                    var nImages = $(this).find(".slideshow-image").length;

                    var alreadyCalled = $(this).find(".slideshow-image").length > 0;
                    if (maxImages > 0 && alreadyCalled && nImages > maxImages) {

                        var image  = $(this).data("image");
                        console.error("Too many slides loaded in slideshow ", slideshow, "\n\"Image " + image + "\".. skip");
                        
                        entry.remove();
                        delete entries[index];
                        return;
                    }

                    if (Slideshow.call(entry, this) === undefined) {
                        entry.remove();
                        delete entries[index];
                        return;
                    }

                }.bind(this));

            //
            // Update entry 
            //
            var position = $(this).data("position") || 0;
            var entry = entries[position];

            $(entry).addClass("show");
            $(entry).on('animationstart  transitionstart' , function() { $(this).addClass(Slideshow.state.ACTIVE); $(entry).addClass(Slideshow.state.ACTIVE); }.bind(this));
            $(entry).on('animationcancel transitioncancel', function() { $(this).removeClass(Slideshow.state.ACTIVE); $(entry).removeClass(Slideshow.state.ACTIVE); }.bind(this));
            $(entry).on('animationend    transitionend'   , function() { $(this).removeClass(Slideshow.state.ACTIVE); $(entry).removeClass(Slideshow.state.ACTIVE); }.bind(this));

            $(entries).each(function() {
                return (this != entry ? $(this).removeClass("show") : this);
            });

            //
            // OPTIONAL: Update pagers
            //
            $(this).find(".slideshow-pager").each(function() { 
                $(this).find(".slideshow-page").removeClass(Slideshow.state.ACTIVE).eq(position).addClass(Slideshow.state.ACTIVE);
            });

            return this;
        });
    }

    Slideshow.find         = function(selector = Slideshow.get("selector")) { return $(selector).filter(function() { return this.id in Slideshow.dict; }); }
    Slideshow.known        = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return this != undefined; }); }
    Slideshow.length       = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).find(".slideshow-entry").length; }); }
    Slideshow.play         = function(selector = Slideshow.get("selector"), options = {}) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.PLAY); }); }
    Slideshow.goto         = function(selector = Slideshow.get("selector"), position)     { return $(Slideshow.find(selector)).map(function() { return $(this).data($(this).hasClass(Slideshow.state.PLAY) ? position-1 : position); }); }
   
    Slideshow.pause        = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).removeClass(Slideshow.state.PLAY); }); }
    Slideshow.fastBackward = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FASTBACKWARD + " " + Slideshow.state.TIMEOUT); }); }
    Slideshow.backward     = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.BACKWARD     + " " + Slideshow.state.TIMEOUT);     }); }
    Slideshow.forward      = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FORWARD      + " " + Slideshow.state.TIMEOUT);      }); }
    Slideshow.fastForward  = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FASTFORWARD  + " " + Slideshow.state.TIMEOUT);  }); }
    
    $(document).ready(function() {
        Slideshow.onLoad();
    });

    return Slideshow;
});