$(function() {
    // draw controls
    var container = $('#GameContainer');
    container.append($('<div id="GameControls"></div>'));
    var controls = $('#GameControls');
  //  controls.append($('<div id="CtrlUp"><img src="gfx/up.png" style="height: 50px;"></div>'));
  //  controls.append($('<div id="CtrlLeft"><img src="gfx/left.png" style="width: 50px;"></div>'));
  //  controls.append($('<div id="CtrlRight"><img src="gfx/right.png" style="width: 50px;"></div>'));
    
    var game = new InfiniteRunner();
    var options = game.getDefaults();
    options.onexit = function() {
        game.dispose();
    }
    game.init(options);
    game.start();

  //  $('#GameControls #CtrlUp').click(function() {   game.command('jump');  });
  //  $('#GameControls #CtrlLeft').click(function() {   game.command('left');  });
  //  $('#GameControls #CtrlRight').click(function() {   game.command('right');  });
});

function InfiniteRunner() {
    // https://gamedevelopment.tutsplus.com/tutorials/creating-a-simple-3d-endless-runner-game-using-three-js--cms-29157
    var sceneWidth;
    var sceneHeight;
    var camera;
    var scene;
    var renderer;
    var dom;
    var sun;

    var rollingGroundSphere; // a big sphere which acts as the ground
    var heroSphere;
    var rollingSpeed = 0.008; // configurable
    var heroRollingSpeed;
    var worldRadius = 26;
    var heroRadius = 0.2;
    var sphericalHelper;
    var pathAngleValues; // angle for trees in each lane
    var heroBaseY = 1.8;
    var bounceValue = 0.1;
    var gravity = 0.005; // configurable
    // lanes
    var lanesX = [-1.2, -0.6, 0, 0.6, 1.2 ]; // there must be 3 or 5, for 3 use [-1,0,1]
    var currentLane;
    
    var clock;
    // trees/objects/obstacles
    var treeReleaseInterval = 0.5; // seconds
    var treesInPath;
    var objectsPool;
    var allObjects = [];
    var numTreesInForest = 60;
    var distributionPath;
    var distributionForest;
    // explosion
    var particleGeometry;
    var particleCount = 60;
    var explosionPower = 1.06;
    var particles;
    // score
    var scoreText;
    var score = 0;
    
    var hasCollided; // set on first collision
    var jumping; // set whilst jumping
    var state = 'idle'; // idle/running/paused/stopped

    var _this = this;

    var options = {};
    
    this.getDefaults = function() {
        var options = {
            speed: 0.008, // should probably be 0.005 - 0.009
            gravity: 0.005, // should probably be 0.003 - 0.007
            fog: 0.14, // set to 0 to disable fog
            keys: { 37: 'left',    39: 'right',
                    38: 'jump',    27: 'gameover',
                    49: 'view1',   50: 'view2',
                    32: 'pause' }, // map keycodes to commands
            distribution: { // how many of each object type should appear
                    path: { tree: 10, ball: 1, coin: 3 }, // absolute numbers
                    forest: { tree: 5, ball: 1, coin: 4, heart: 1 } // relative numbers
                },
            scores: { collide: 0,
                      miss_before_collide: 10,
                      miss_after_collide: 1,
                      max: 90000 },
            colours: { floor: '#e0e0c0', tree: 0x33ff33, treetrunk: 0x886633,
                       ball: 0x5020c0, coin: 0xffff20,
                       fog: 0xf0fff0, explosion: 0xffcc44, score: '#ffe080',
                       sun: 0xcdc1c5, sky: 0xfffafa, hero: 0xe5f2f2 },
            onupdatescore: false, // set to a callback function, eg. function updscore(score) {  ...  }
            oncollide: false, // called on each collision
            onexit: false, // called at the end
            onresize: false, // called when the window resizes
        }
        return JSON.parse(JSON.stringify(options)); // clone
    }

    this.init = function(opts) {
        if (typeof opts != 'object')    opts = {};
        
        options = this.getDefaults();
        for (var name in opts)
            options[name] = opts[name];
        
        state = 'idle';
        if (options.gravity)   gravity = options.gravity;
        if (options.speed)     rollingSpeed = options.speed;
        
        var dist = options.distribution
        if (typeof dist != 'object')   dist = {};
        distributionPath = dist.path;
        if (typeof distributionPath != 'object')    distributionPath = { tree: 10 }; // absolute number of each type
    
        distributionForest = dist.forest;
        if (typeof distributionForest != 'object')    distributionForest = { tree: 1 }; // relative dist. of the types
        var total = 0;
        for (var t in distributionForest)   total += distributionForest[t];
        if (total < 1)    total = 1;
        for (var t in distributionForest)    distributionForest[t] = Math.ceil(distributionForest[t] * numTreesInForest / total);
        console.log('object distribution', distributionPath, distributionForest);

        allObjects = [];

        // set up the scene
        createScene();
    }
    
    this.start = function() {
        if (state != 'idle')   return false;
        // call game loop
        state = 'running';
        update();
        return true;
    }
    
    this.stop = function() {
        if (state != 'stopped')   gameOver();
    }
    
    this.dispose = function() {
        this.stop();
        sceneTraverse(scene, function(o) {
            if (o.geometry)
                o.geometry.dispose()

            if (o.material) {
                if (o.material.length) {
                    for (let i = 0; i < o.material.length; i++)
                        o.material[i].dispose()
                }
                else {
                    o.material.dispose()
                }
            }
        });
        clock = null;
        sun = null;
        scene = null;
        camera = null;
        ground = null;
        renderer = null;
        rollingGroundSphere = null;
        heroSphere = null;
 
        $(window).off('resize', onWindowResize);
        if (typeof options.keys == 'object')
            $(document).off('keydown', handleKeyDown);
    }
 
    this.command = function(cmd, args) {
        if (state == 'idle' || state == 'stopped')   return false;
        console.log("command "+cmd);
        switch (cmd) {
            case 'pause':
                if (state == 'paused')
                    state = 'running';
                else if (state == 'running')
                    state = 'paused';
                console.log('state='+state);
                break;
                
            case 'gameover':
                gameOver();
                break;

            case 'addscore': // args is an int to add
                if (args < 1)    return false;
                score += parseInt(args);
                if (typeof options.onupdatescore == 'function')
                    options.onupdatescore(score);
                else
                    updateScore();
                
                if (options.scores.max !== false && score >= options.scores.max)
                    this.command('gameover', 'MAXIMUM SCORE');
                break;

            case 'setscore': // args is the new score, as an int
                score = parseInt(args);
                if (typeof options.onupdatescore == 'function')
                    options.onupdatescore(score);
                else
                    updateScore();
                break;

            case 'explode':
                explode();
                break;

            case 'jump': // no args
                if (jumping)   return;
                bounceValue = 0.1;
                jumping = true;
                break;

            case 'left': // no args
                if (jumping)   return;
                if (currentLane >= 1) {
                    currentLane--;
                    jumping = true; // bounce a little when changing lane
                    bounceValue = 0.06;
                }
                break;

            case 'right': // no args
                if (jumping)   return;
                if (currentLane < lanesX.length-1) {
                    currentLane++;
                    jumping = true; // bounce a little when changing lane
                    bounceValue = 0.06;
                }
                break;
                
            case 'view1':
                camera.position.y = 2.5;
                camera.position.z = 6.5;
                camera.rotation.x = 0;
                camera.updateProjectionMatrix();
                break;
            case 'view2':
                camera.position.y = 3.5;
                camera.position.z = 7.5;
                camera.rotation.x = -0.3;
                camera.updateProjectionMatrix();
                break;
        }
        return false;
    }
    
    function createScene() {
        // init various stuff
        pathAngleValues = [];
        for (var i = 0; i < lanesX.length; i++)
            pathAngleValues.push(Math.PI/2 - (i - Math.floor(lanesX.length/2))*0.03);
        
        hasCollided = false;
        score = 0;
        treesInPath = [];
        objectsPool = [];
        
        clock = new THREE.Clock();
        clock.start();
        
        heroRollingSpeed = (rollingSpeed*worldRadius/heroRadius)/5;
        sphericalHelper = new THREE.Spherical();
        sceneWidth = window.innerWidth-30; // -30 to prevent scrollbars
        sceneHeight = window.innerHeight-30;
        scene = new THREE.Scene(); // the 3d scene
        
        if (options.fog > 0)
            scene.fog = new THREE.FogExp2( options.colours.fog, options.fog );
        
        camera = new THREE.PerspectiveCamera( 60, sceneWidth / sceneHeight, 0.1, 1000 ); // perspective camera
        renderer = new THREE.WebGLRenderer({alpha: true}); // renderer with transparent backdrop
        renderer.setClearColor(options.colours.sky, 1); 
        renderer.shadowMap.enabled = true;//enable shadow
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setSize( sceneWidth, sceneHeight );
        dom = document.getElementById('GameContainer');
        dom.appendChild(renderer.domElement);

        createObjectsPool();
        addWorld();
        addHero();
        addLight();
        addExplosion();
        
        camera.position.z = 6.5;
        camera.position.y = 2.5;
        $(window).off('resize', onWindowResize).on('resize', onWindowResize);

        // possibly setup default key handler
        if (typeof options.keys == 'object') {
            $(document).off('keydown', handleKeyDown).on('keydown', handleKeyDown);
        }
        
        if (typeof options.onupdatescore == 'function') {
            // display of score is handled by the frontend
            options.onupdatescore(score);
        } else {
            // create a div for displaying the score
            scoreText = document.createElement('div');
            scoreText.style.position = 'absolute';
            // scoreText.style.zIndex = 1;    // if you still don't see the label, try uncommenting this
            scoreText.style.width = 300;
            scoreText.style.height = 100;
            scoreText.style.color = options.colours.score;
            scoreText.style.fontSize = "5em";
            scoreText.style.fontWeight = "bold";
            scoreText.innerHTML = "0";
            scoreText.style.top = '20px';
            scoreText.style.left = '20px';
            document.body.appendChild(scoreText);
            updateScore();
        }
    }

    // default key handler, only used if options.keys is an object
    function handleKeyDown(keyEvent) {
        if (jumping)   return;
        var key = keyEvent.keyCode;
        console.log("key "+key);
        
        if (options.keys[key] === 'left') {
            _this.command('left');
        } else if (options.keys[key] === 'right') {
            _this.command('right');
        } else if (options.keys[key] === 'gameover') {
            _this.command('gameover');
        } else if (options.keys[key] === 'pause') {
            _this.command('pause');
        } else if (options.keys[key] === 'jump') {
            _this.command('jump');
        } else if (options.keys[key] === 'view1') {
            _this.command('view1');
        } else if (options.keys[key] === 'view2') {
            _this.command('view2');
        } else {
            return false;
        }
        //heroSphere.position.x=currentLane;
        keyEvent.preventDefault();
        return false;
    }
    
    function addHero() {
        var sphereGeometry = new THREE.DodecahedronGeometry(heroRadius, 1);
        var sphereMaterial = new THREE.MeshStandardMaterial( { color: options.colours.hero, shading:THREE.FlatShading} )
        jumping = false;
        heroSphere = new THREE.Mesh( sphereGeometry, sphereMaterial );
        heroSphere.receiveShadow = true;
        heroSphere.castShadow = true;
        scene.add(heroSphere);
        heroSphere.position.y = heroBaseY;
        heroSphere.position.z = 4.8;
        currentLane = Math.floor(lanesX.length / 2);
        heroSphere.position.x = lanesX[currentLane];
return;
        
        var person_shape = {
            leftleg:  { type: 'box', color: 0x6666cc, size: [ 0.4, 0.7, 0.4 ], xyz: [  0.25, 0.3, 0 ] },
            rightleg: { type: 'box', color: 0x6666cc, size: [ 0.4, 0.7, 0.4 ], xyz: [ -0.25, 0.3, 0 ] },
            torso:     { type: 'box', color: 0x000000, size: [ 1, 0.7, 0.5 ], xyz: [ 0, 1, 0 ] },
            shoulders: { type: 'box', color: 0x000000, size: [ 1.5, 0.3, 0.5 ], xyz: [ 0, 1.5, 0 ] },
            leftarm: { type: 'box', color: 0xccaa55, size: [ 0.2, 0.3, 0.2 ], xyz: [ -0.7, 1.2, 0 ] },
            rightarm: { type: 'box', color: 0xccaa55, size: [ 0.2, 0.3, 0.2 ], xyz: [ 0.6, 1.2, 0 ] },
        };
        var person = createShape(person_shape);
        scene.add(person);
        person.position.x = -1;
        person.position.y = 2;
        person.position.z = 3;
    }
    
    function addWorld() {
        var sides = 40;
        var tiers = 40;
        var sphereGeometry = new THREE.SphereGeometry( worldRadius, sides,tiers);
        var sphereMaterial = new THREE.MeshStandardMaterial( { color: options.colours.floor, shading:THREE.FlatShading} )
        
        var vertexIndex;
        var vertexVector = new THREE.Vector3();
        var nextVertexVector = new THREE.Vector3();
        var firstVertexVector = new THREE.Vector3();
        var offset = new THREE.Vector3();
        var currentTier = 1;
        var lerpValue = 0.5;
        var heightValue;
        var maxHeight = 0.07;
        for (var j = 1; j < tiers-2; j++) {
            currentTier = j;
            for (var i = 0; i < sides; i++) {
                vertexIndex = (currentTier*sides)+1;
                vertexVector = sphereGeometry.vertices[i+vertexIndex].clone();
                if (j%2 !== 0) {
                    if (i == 0) {
                        firstVertexVector = vertexVector.clone();
                    }
                    nextVertexVector = sphereGeometry.vertices[i+vertexIndex+1].clone();
                    if (i == sides-1) {
                        nextVertexVector = firstVertexVector;
                    }
                    lerpValue = (Math.random()*(0.75-0.25))+0.25;
                    vertexVector.lerp(nextVertexVector,lerpValue);
                }
                heightValue = (Math.random()*maxHeight)-(maxHeight/2);
                offset = vertexVector.clone().normalize().multiplyScalar(heightValue);
                sphereGeometry.vertices[i+vertexIndex] = (vertexVector.add(offset));
            }
        }
        rollingGroundSphere = new THREE.Mesh( sphereGeometry, sphereMaterial );
        rollingGroundSphere.receiveShadow = true;
        rollingGroundSphere.castShadow = false;
        rollingGroundSphere.rotation.z =- Math.PI/2;
        scene.add( rollingGroundSphere );
        rollingGroundSphere.position.y = -24;
        rollingGroundSphere.position.z = 2;
        addWorldObjects();
    }
    
    function addLight() {
        var hemisphereLight = new THREE.HemisphereLight(0xfffafa, 0x000000, .9)
        scene.add(hemisphereLight);
        sun = new THREE.DirectionalLight( options.colours.sun, 0.9);
        sun.position.set( 12, 6, -7 );
        sun.castShadow = true;
        scene.add(sun);
        // Set up shadow properties for the sun light
        sun.shadow.mapSize.width = 256;
        sun.shadow.mapSize.height = 256;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 50;
    }
  
    // ---------- SCORE ----------

    function updateScore() {
        var txt = '0000'+score.toString();
        scoreText.innerHTML = txt.substr(-5);
    }

// TODO make score configurable    
    function getScore(action, objtype) {
        return options.score.collide;
    }

    // ---------- OBJECTS/OBSTACLES ----------
   
    /**
     * Create a pool of trees that can later be added to the path
     */
    function createObjectsPool() {
        var num = 0;
        for (var t in distributionPath)   num += distributionPath[t];
        
        console.log('creating path objects');
        for (var i = 0; i < num; i++) {
            var obj = createObject(distributionPath);
            objectsPool.push(obj);
        }
        shuffleArray(objectsPool);
    }
    
    /**
     * Add 1 or 2 trees to the path
     */
    function addPathObject() {
        var possibleLanes = [0,1,2]; // possible lanes
        if (lanesX.length == 5) { possibleLanes.push(3);   possibleLanes.push(4);  }
        // pick a lane
        var lane = Math.floor(Math.random() * possibleLanes.length);
        // add tree to the lane
        addObject(true, lane);
        // remove the lane from the list of possible lanes
        possibleLanes.splice(lane, 1);
        if (Math.random() > 0.5) {
            // pick another lane
            lane = Math.floor(Math.random() * possibleLanes.length);
            // add tree to the lane
            addObject(true, possibleLanes[lane]);
        }
    }

    /**
     * Create/add trees to the forest outside the path
     */
    function addWorldObjects() {
        // build list of obj.types to create
        var d = [];
        for (var t in distributionForest) {
            // double the num. of each type, as there is one on each side
            var n = distributionForest[t] * 2;
            for (var i = 0; i < n; i++)    d.push(t);
        }
        shuffleArray(d);
        distributionForest = d;
        console.log('creating forest', d);

        var n = d.length/2;
        var gap = 6.28/n; // 6.28 = 2*PI
        for (var i = 0; i < n; i++) {
            addObject(false, i*gap, true);
            addObject(false, i*gap, false);
        }
    }

    /**
     * Add an object/obstacle to the world
     * @param bool inPath True to add to the path of the 'hero', or false to add to the forest outside the path
     * @param float row Either a lane no (if inPath=true), or the location on the world as an angle (if inPath=false)
     * @param isLeft Determines if the object is on the left or right, only if inPath=false
     */
    function addObject(inPath, row, isLeft) {
        var obj, phi, theta;
        if (inPath) {
            // move a tree from the pool to the path
            if (objectsPool.length == 0)   return;
            obj = objectsPool.pop();
            obj.visible = true;
            treesInPath.push(obj);
            phi = pathAngleValues[row];
            theta = -rollingGroundSphere.rotation.x+4;
        } else {
            // create an object based on the distribution of obj.types
            obj = createObject(distributionForest);
            if (isLeft) {
                phi = 1.68+Math.random()*0.1;
            } else {
                phi = 1.46-Math.random()*0.1;
            }
            theta = row;
        }
        sphericalHelper.set( worldRadius - 0.3, phi, theta );
        // put the object in the world
        obj.position.setFromSpherical( sphericalHelper );
        var rollingGroundVector = rollingGroundSphere.position.clone().normalize();
        var treeVector = obj.position.clone().normalize();
        obj.quaternion.setFromUnitVectors(treeVector, rollingGroundVector);
        obj.rotation.x += (Math.random()*(2*Math.PI/10)) - Math.PI/10;
        
        rollingGroundSphere.add(obj);
    }

    function addObject2(inPath, row, isLeft) {
        var obj, phi, theta;
        if (inPath) {
            // move a tree from the pool to the path
            if (objectsPool.length == 0)   return;
            obj = objectsPool.pop();
            obj.visible = true;
            treesInPath.push(obj);
            phi = pathAngleValues[row];
            theta = -rollingGroundSphere.rotation.x+4;
        } else {
            // create an object based on the distribution of obj.types
            obj = createObject(distributionForest);
            if (isLeft) {
                phi = 1.68+Math.random()*0.1;
            } else {
                phi = 1.46-Math.random()*0.1;
            }
            theta = row;
        }
        sphericalHelper.set( worldRadius + 0.5, phi, theta );
        // put the object in the world
        obj.position.setFromSpherical( sphericalHelper );
      //  obj.rotation.x += (Math.random()*(2*Math.PI/10)) - Math.PI/10;
      //  obj.rotation.z = -phi; //Math.PI/2;
        
        rollingGroundSphere.add(obj);
    }

    /**
     * Create an obstacle/object
     * @param mixed distribution Either an object type string (eg. 'tree') or a distribution of object types
     * @return object
     */
    function createObject(distribution) {
        var objtype = 'tree';
        if (typeof distribution == 'string')
            objtype = distribution;
        else if (distribution instanceof Array)
            objtype = distribution.pop();
        else {
            // get object type from the distribution of object types
            for (var t in distribution) {
                var numleft = distribution[t];
                if (numleft > 0) {
                    objtype = t;
                    distribution[objtype] = numleft-1;
                    break;
                }
            }
        }
        if (!objtype)   objtype = 'tree';
        
        var obj;
        console.log('creating', objtype);
        switch (objtype) {
            case 'tree':    obj = createTree();   break;
            case 'ball':    obj = createBall();   break;
            case 'coin':    obj = createCoin();   break;
            case 'heart':   obj = createHeart();   break;
        }
        
        obj.userData = { objtype: objtype };
        allObjects.push({ object: obj, objtype: objtype });
        return obj;
    }
    
    function createHeart() {
        const heart = new THREE.Shape();
        heart.moveTo( 25, 25 );
        heart.bezierCurveTo( 25, 25, 20, 0, 0, 0 );
        heart.bezierCurveTo( - 30, 0, - 30, 35, - 30, 35 );
        heart.bezierCurveTo( - 30, 55, - 10, 77, 25, 95 );
        heart.bezierCurveTo( 60, 77, 80, 55, 80, 35 );
        heart.bezierCurveTo( 80, 35, 80, 0, 50, 0 );
        heart.bezierCurveTo( 35, 0, 25, 25, 25, 25 );

        const extrude = { depth: 100, bevelEnabled: false };

        const geometry = new THREE.ExtrudeGeometry( heart, extrude );
        geometry.scale(0.007, -0.007, 0.001);
        geometry.computeBoundingBox();
        geometry.center();
        
        const material = new THREE.MeshPhongMaterial({ color: 0xff2050 })
        const mesh = new THREE.Mesh( geometry, material );
        mesh.position.y = 1.2;

        var obj = new THREE.Object3D();
        obj.add(mesh);
        return obj;
    }
        
    function createBall() {
        var geometry = new THREE.DodecahedronGeometry(heroRadius*1.3, 1);
        geometry.computeBoundingBox();
        geometry.center();
        var material = new THREE.MeshStandardMaterial( { color: options.colours.ball, shading:THREE.FlatShading} )
        var ball = new THREE.Mesh( geometry, material );
        ball.position.y = 0.7;

        var obj = new THREE.Object3D();
        obj.add(ball);
        return obj;
    }
    
    function createCoin() {
        var geometry = new THREE.CylinderGeometry( 0.3, 0.3, 0.15, 60);
        geometry.computeBoundingBox();
        geometry.center();
        var material = new THREE.MeshStandardMaterial( { color: options.colours.coin, shading:THREE.FlatShading, metalness: 0.1 } )
        var coin = new THREE.Mesh( geometry, material );
        coin.position.y = 0.8;
        coin.rotation.x = 1.57;
        var obj = new THREE.Object3D();
        obj.add(coin);
        return obj;
    }

    function createTree() {
        var sides = 8;
        var tiers = 6;
        var scalarMultiplier = Math.random()*0.15 + 0.05; // 0.05 - 0.20
        
        function blowUpTree(vertices, sides, currentTier, scalarMultiplier, odd) {
            var vertexIndex;
            var vertexVector = new THREE.Vector3();
            var midPointVector = vertices[0].clone();
            var offset;
            for (var i = 0; i < sides; i++) {
                vertexIndex = (currentTier*sides)+1;
                vertexVector = vertices[i+vertexIndex].clone();
                midPointVector.y = vertexVector.y;
                offset = vertexVector.sub(midPointVector);
                if (odd) {
                    if (i%2 === 0) {
                        offset.normalize().multiplyScalar(scalarMultiplier/6);
                        vertices[i+vertexIndex].add(offset);
                    } else {
                        offset.normalize().multiplyScalar(scalarMultiplier);
                        vertices[i+vertexIndex].add(offset);
                        vertices[i+vertexIndex].y = vertices[i+vertexIndex+sides].y+0.05;
                    }
                } else {
                    if (i%2 !==0) {
                        offset.normalize().multiplyScalar(scalarMultiplier/6);
                        vertices[i+vertexIndex].add(offset);
                    } else {
                        offset.normalize().multiplyScalar(scalarMultiplier);
                        vertices[i+vertexIndex].add(offset);
                        vertices[i+vertexIndex].y = vertices[i+vertexIndex+sides].y+0.05;
                    }
                }
            }
        }

        function tightenTree(vertices, sides, currentTier) {
            var vertexIndex;
            var vertexVector = new THREE.Vector3();
            var midPointVector = vertices[0].clone();
            var offset;
            for (var i = 0; i < sides; i++) {
                vertexIndex = (currentTier*sides)+1;
                vertexVector = vertices[i+vertexIndex].clone();
                midPointVector.y = vertexVector.y;
                offset = vertexVector.sub(midPointVector);
                offset.normalize().multiplyScalar(0.06);
                vertices[i+vertexIndex].sub(offset);
            }
        }
        
        var vertexVector = new THREE.Vector3();
        var treeGeometry = new THREE.ConeGeometry( 0.5, 1, sides, tiers);
        var treeMaterial = new THREE.MeshStandardMaterial( { color: options.colours.tree, shading:THREE.FlatShading  } );
        blowUpTree(treeGeometry.vertices, sides, 0, scalarMultiplier);
        tightenTree(treeGeometry.vertices, sides, 1);
        blowUpTree(treeGeometry.vertices, sides, 2, scalarMultiplier*1.1, true);
        tightenTree(treeGeometry.vertices, sides, 3);
        blowUpTree(treeGeometry.vertices, sides, 4, scalarMultiplier*1.2);
        tightenTree(treeGeometry.vertices, sides, 5);
        
        var treeTop = new THREE.Mesh( treeGeometry, treeMaterial );
        treeTop.castShadow = true;
        treeTop.receiveShadow = false;
        treeTop.position.y = 0.9;
        treeTop.rotation.y = Math.random()*Math.PI;
        
        var treeTrunkGeometry = new THREE.CylinderGeometry( 0.1, 0.1, 0.5);
        var trunkMaterial = new THREE.MeshStandardMaterial( { color: options.colours.treetrunk, shading:THREE.FlatShading  } );
        var treeTrunk = new THREE.Mesh( treeTrunkGeometry, trunkMaterial );
        treeTrunk.position.y = 0.25;
    
        var tree = new THREE.Object3D();
        tree.add(treeTrunk);
        tree.add(treeTop);
        return tree;
    }

    function doTreeLogic() {
        var pos = new THREE.Vector3();
        var treesToRemove = [];
        treesInPath.forEach( function ( element, index ) {
            var obj = treesInPath[ index ];
            pos.setFromMatrixPosition( obj.matrixWorld );
            if (pos.z > 6 && obj.visible) {
                // gone out of our view zone
                treesToRemove.push(obj);
            } else {
                // check collision
                if (pos.distanceTo(heroSphere.position) <= 0.6) {
                    console.log("hit", obj.userData);
                    hasCollided = true;
                    var score = options.scores.collide;
                    _this.command('addscore', score);
                    if (typeof options.oncollide == 'function')
                        options.oncollide();
                    else
                        _this.command('explode');
                }
            }
        });

        // moved the disappeared trees to the pool
        treesToRemove.forEach( function ( element, index ) {
            var obj = treesToRemove[ index ];
            var fromWhere = treesInPath.indexOf(obj);
            treesInPath.splice(fromWhere, 1);
            objectsPool.push(obj);
            obj.visible = false;
            console.log("remove tree");
        });

        shuffleArray(objectsPool);
    }
    
    // ---------- EXPLOSION ----------
    
    /**
     * Animate particles
     */
    function doExplosionLogic() {
        if (!particles.visible)   return;
        for (var i = 0; i < particleCount; i++) {
            particleGeometry.vertices[i].multiplyScalar(explosionPower);
        }
        if (explosionPower > 1.005) {
            explosionPower -= 0.001;
        } else {
            particles.visible = false;
        }
        particleGeometry.verticesNeedUpdate = true;
    }
    
    /**
     * Start explosion, reset particles to random positions
     */
    function explode() {
        particles.position.y = 2;
        particles.position.z = 4.8;
        particles.position.x = heroSphere.position.x;
        for (var i = 0; i < particleCount; i++ ) {
            var vertex = new THREE.Vector3();
            vertex.x = -0.2 + Math.random() * 0.4;
            vertex.y = -0.2 + Math.random() * 0.4 ;
            vertex.z = -0.2 + Math.random() * 0.4;
            particleGeometry.vertices[i] = vertex;
        }
        explosionPower = 1.07;
        particles.visible = true;
    }
      
    /**
     * Create the particles for the explosion, make them invisible
     */
    function addExplosion(){
        particleGeometry = new THREE.Geometry();
        for (var i = 0; i < particleCount; i++ ) {
            var vertex = new THREE.Vector3();
            particleGeometry.vertices.push( vertex );
        }
        var pMaterial = new THREE.ParticleBasicMaterial({
          color: options.colours.explosion,
          size: (particleCount >= 30) ? 0.05 : 0.10,
        });
        particles = new THREE.Points( particleGeometry, pMaterial );
        scene.add( particles );
        particles.visible = false;
    }
    
    // ---------- VARIOUS ----------

    function shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    function animate() {
        for (var i = 0; i < allObjects.length; i++) {
            var obj = allObjects[i];
            switch (obj.objtype) {
                case 'coin':
                    if (obj.speed == undefined)    obj.speed = Math.random()/25+0.001;
                    if (obj.object.children)
                        obj.object.children.forEach(function(o) {
                            o.rotation.z += obj.speed;
                    });
                    break;
                case 'heart':
                    if (obj.speed == undefined)    obj.speed = Math.random()/25+0.001;
                    if (obj.object.children)
                        obj.object.children.forEach(function(o) {
                            o.rotation.y += obj.speed;
                    });
                    break;
                case 'ball':
                    if (obj.object.children)
                        obj.object.children.forEach(function(o) {
                            if (obj.starty == undefined) {
                                obj.starty = o.position.y;
                                obj.speed = Math.random()/10 + 0.10;
                                obj.t = 0;
                            }
                            o.position.y = obj.starty + Math.sin(obj.t)/10;
                            obj.t += obj.speed;
                    });
                    break;
            }
            
        }
    }

    /**
     * This is called repeated and handles everything
     */
    function update() {
        if (state == 'stopped')    return;
        
        if (state == 'running')
            rollingGroundSphere.rotation.x += rollingSpeed;

        heroSphere.rotation.x -= heroRollingSpeed;
        if (heroSphere.position.y <= heroBaseY) {
            jumping = false;
            bounceValue = (Math.random()*0.04)+0.005;
        }
        heroSphere.position.y += bounceValue;
        heroSphere.position.x = THREE.Math.lerp(heroSphere.position.x, lanesX[currentLane], 2*clock.getDelta());
        bounceValue -= gravity;
    
        if (state == 'running') {
            if (clock.getElapsedTime() > treeReleaseInterval) {
                clock.start();
                addPathObject();
                if (hasCollided)
                    _this.command('addscore', options.scores.miss_after_collide);
                else
                    _this.command('addscore', options.scores.miss_before_collide);
            }
            
            doTreeLogic();
        }
        
        animate();
        doExplosionLogic();
        render();
        requestAnimationFrame(update); // request next update
    }

    function createShape(def) {
        var shape = new THREE.Group();
        for (var name in def) {
            var part = def[name];
            
            var geo = false;
            switch (part.type) {
                case 'box':
                    geo = new THREE.BoxGeometry( part.size[0], part.size[1], part.size[2] );
                    break;
                case 'group':
                    var grp = createShape(part.parts);
                    shape.add(grp);
                    grp.position.set(part.xyz[0], part.xyz[1], part.xyz[2]);
                    break;
            }
            if (!geo)    continue;
            var material = new THREE.MeshToonMaterial( {color: part.color} );
            var mesh = new THREE.Mesh( geo, material );
            mesh.position.set(part.xyz[0], part.xyz[1], part.xyz[2]);
            part.object = mesh;
            shape.add(mesh);
        }
        return shape;
    }

    function render() {
        renderer.render(scene, camera); //draw
    }
    
    function gameOver() {
        console.log("game over");
        rollingSpeed = 0;
        state = 'stopped';
        if (typeof options.onexit == 'function')
            options.onexit();
    }
    
    function onWindowResize() {
        //resize & align
        sceneHeight = window.innerHeight-30; // -30 to prevent scrollbars
        sceneWidth = window.innerWidth-30;
        renderer.setSize(sceneWidth, sceneHeight);
        camera.aspect = sceneWidth/sceneHeight;
        camera.updateProjectionMatrix();
        
        if (typeof options.onresize == 'function')
            options.onresize();
    }

    function sceneTraverse(obj, fn) {
        if (!obj) return

        fn(obj)

        if (obj.children && obj.children.length > 0)
            obj.children.forEach(function(o) {
                sceneTraverse(o, fn)
            })
    }
}
