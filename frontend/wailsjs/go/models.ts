export namespace main {
	
	export class Config {
	    fontFamily: string;
	    themeMode: string;
	    editorPath: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fontFamily = source["fontFamily"];
	        this.themeMode = source["themeMode"];
	        this.editorPath = source["editorPath"];
	    }
	}
	export class LoadResult {
	    html: string;
	    raw: string;
	
	    static createFrom(source: any = {}) {
	        return new LoadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.html = source["html"];
	        this.raw = source["raw"];
	    }
	}

}

