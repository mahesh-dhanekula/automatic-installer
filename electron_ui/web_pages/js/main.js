var path = require('path');
var fs = require('fs');
var axios = require('axios');
const { shell } = require('electron');

artifactory_dict = {
    'Azure': 'http://azwec7artsrv01.ansys.com:8080/artifactory',
    'Austin': 'http://ausatsrv01.ansys.com:8080/artifactory',
    'Boulder': 'http://bouartifact.ansys.com:8080/artifactory',
    'Canonsburg': 'http://canartifactory.ansys.com:8080/artifactory',
    'Concord': 'http://convmartifact.win.ansys.com:8080/artifactory',
    'Darmstadt': 'http://darvmartifact.win.ansys.com:8080/artifactory',
    'Evanston': 'http://evavmartifact:8080/artifactory',
    'Hannover': 'http://hanartifact1.ansys.com:8080/artifactory',
    'Horsham': 'http://horvmartifact1.ansys.com:8080/artifactory',
    'Lebanon': 'http://lebartifactory.win.ansys.com:8080/artifactory',
    'Lyon': 'http://lyovmartifact.win.ansys.com:8080/artifactory',
    'Otterfing': 'http://ottvmartifact.win.ansys.com:8080/artifactory',
    'Pune': 'http://apac.artifactory.ansys.com:8080/artifactory',
    'Sheffield': 'http://shfvmartifact.win.ansys.com:8080/artifactory',
    'SanJose': 'http://sjoartsrv01.ansys.com:8080/artifactory',
    'Waterloo': 'https://watartifactory.win.ansys.com:8443/artifactory',
    'SharePoint': 'https://ansys.sharepoint.com/sites/BetaDownloader'
};

app_folder = path.join(app.getPath("appData"), "build_downloader")
settings_path = path.join(app_folder, "default_settings.json");
whatisnew_path = path.join(app_folder, "whatisnew.json");
all_days = ["mo", "tu", "we", "th", "fr", "sa", "su"]
products_dict = {};


function seconds_since_epoch() {
    return Math.round(Date.now() / 1000);
}


ipcRenderer.on('products', (event, products) => {
    products_dict = products;
    let time_passed = seconds_since_epoch() - products_dict.last_refreshed;

    if (!products_dict || !products_dict.versions || time_passed > 43200) {
        // request new builds list only once per 12h
        request_builds();
    } else {
        fill_versions(products_dict.versions);
    }
});

window.onload = function() {
    /**
     * Function is fired on the load the window. Verifies that settings file exists in APPDATA.
     * If exists => read settings and populate UI data from the file
     * If not => create default file with settings and dump it to settings file. Then use these settings for UI.
     * 
     * Gets active schtasks.
     * Runs function to set tooltips text
     */

    check_backend_version();

    if (!fs.existsSync(app_folder)) fs.mkdirSync(app_folder);

    if (!fs.existsSync(whatisnew_path)) {
        ipcRenderer.send('whatsnew_show');
    } else {
        let new_versions_data = fs.readFileSync(whatisnew_path);
        let new_versions = JSON.parse(new_versions_data);
        for (var key in whatsnew) {
            // check if all versions were shown to user
            if (!new_versions.shown.includes(key)) {
                ipcRenderer.send('whatsnew_show');
                break;
            }
        }
    }

    if (!fs.existsSync(settings_path)) {
        settings = {
            "artifactory": "SharePoint",
            "username": process.env.USERNAME,
            "password": {"Otterfing": ""},
            "version": "",
            "install_path": get_previous_edt_path(),
            "download_path": app.getPath("temp"),
            "license_file": "",
            "delete_zip": true,
            "force_install": false,
            "replace_shortcut": true,
            "wb_flags": "",
            "custom_flags": "",
            "days": [
                "tu", "th", "sa"
            ],
            "time": "01:30"
        }

        let data = JSON.stringify(settings, null, 4);
        fs.writeFileSync(settings_path, data);
        ipcRenderer.send('agreement_show');
    } else {
        var settings_data = fs.readFileSync(settings_path);
        settings = JSON.parse(settings_data);
    }

    $("#username").val(settings.username);
    
    for (var i in all_days) {
        $(`#${all_days[i]}-checkbox`).prop("checked", settings.days.includes(all_days[i]));
    }

    $("#time").val(settings.time);


    set_selector("artifactory", Object.keys(artifactory_dict), settings.artifactory);

    get_active_tasks();

    // get product and continue getting them every 120s
    ipcRenderer.send('get-products');
    window.setInterval(() => {ipcRenderer.send('get-products')}, 120000);
    set_default_tooltips_main();
    change_password();
}


function get_previous_edt_path() {
    /**
     * parse environment variables and search for EM installation. If some build was installed
     * propose the same directory
     * Otherwise search for previous Workbench installation and propose it
     * If nothing is found propose C:/program files
    */
    let all_vars = Object.keys(process.env);
    let env_var = "";
    for (var i in all_vars){
        if (all_vars[i].toLowerCase().includes("ansysem_root")) env_var = process.env[all_vars[i]];
    }

    if (!env_var){
        // search for Workbench env var match eg "ANSYS202_DIR"
        const regex_str = /ansys[0-9]{3,}_dir/;
        for (var i in all_vars){
            if (all_vars[i].toLowerCase().match(regex_str)) env_var = process.env[all_vars[i]];
        }
    }
    if (!env_var){
        return "C:\\Program Files";
    }
    return path.dirname(path.dirname(path.dirname(env_var)));
}


function set_selector(id, obj_list, default_item="") {
    /**
     * @param  {string} id: id of the drop down menu
     * @param  {Array} obj_list: list of objects to fill in the menu
     * @param  {string} default_item="": default selection
     */
    const selector = document.getElementById(id);
    $("#" + id).empty();

    for (var i in obj_list) {
        option = document.createElement("option");
        option.textContent = obj_list[i];
        option.value = obj_list[i];
        selector.add(option);
    }

    if(obj_list.includes(default_item)) {
        selector.value = default_item;
    }
}


const save_settings = function () {
    /**
     * Dump settings to the JSON file in APPDATA. Fired on any change in the UI
     */
    const all_checkboxes = ["mo-checkbox", "tu-checkbox", "we-checkbox", "th-checkbox", "fr-checkbox",
        "sa-checkbox", "su-checkbox"];

    if (all_checkboxes.includes(this.id)) {
        var new_days = [];
        for (var i in all_checkboxes) {
            checkbox = $("#" + all_checkboxes[i])[0];
            if (checkbox.checked == true) {
                new_days.push(all_checkboxes[i].slice(0, 2));
            }
        }
        settings.days = new_days;
    } else if (this.id === "password") {
        settings.password[settings.artifactory] = this.value;
    } else {
        settings[this.id] = this.value;
    }

    let data = JSON.stringify(settings, null, 4);
    fs.writeFileSync(settings_path, data);
};


function request_builds() {
    /**
     * Send request to the server using axios. Try to retrive info about 
     * available builds on artifactory
    */
    $("#version").empty();
    $("#version").append($('<option>', {value:1, text:"Loading data..."}))
    clean_products_list();

    if (!settings.username) {
        error_tooltip.call($('#username'), "Provide your Ansys User ID");
        return;
    }

    if ($("#artifactory").val() != "SharePoint"){
        if (!settings.password[settings.artifactory]) {
            error_tooltip.call($('#password'), "Provide Artifactory unique password");
            return;
        }
    } else {
        setTimeout(() => {
            get_sharepoint_builds();
        }, 1000);
        return;
    }

    artifactory_request('/api/repositories').then((response)=>{
        if (response && response.status == 200){
            get_builds(response.data);
        } 
    })
}


async function artifactory_request(url, sso_pass="", req_type="get") {
    // // uncomment this snippet (and comment below) to test any status code
    // axios.get('https://httpstat.us/500', {
    //     timeout: 30000
    //   })

    let password = sso_pass;
    if (!sso_pass) {
        password = settings.password[settings.artifactory];
    }

    let config = {
        url: url,
        baseURL: artifactory_dict[settings.artifactory],
        method: req_type,
        auth: {
            username: settings.username,
            password: password
        },
        timeout: 6000
    }

    try {
        const response = await axios.request(config);
        return response

    } catch (err) {
        console.log(err.response);
        if (!err.response && !err.code) {
            error_tooltip.call($('#artifactory'), "Check that you are on VPN and retry in 10s (F5)");
        } else if (err.code === 'ECONNABORTED'){
            error_tooltip.call($('#username'), "Timeout on connection, check Ansys User ID");
            error_tooltip.call($('#password'), "Timeout on connection, check Password or/and retry (F5)");
        } else if (err.response.status === 401){
            error_tooltip.call($('#username'), "Bad credentials, check Ansys User ID");
            error_tooltip.call($('#password'), "Bad credentials, check Artifactory unique password");
        } else if (err.response.status === 500){
            error_tooltip.call($('#artifactory'), "Internal Server Error, try another artifactory");
        } else if (err.response.status !== 200){
            error_tooltip.call($('#artifactory'), err.response.statusText);
        }
    }
}


function send_get_api_request(sso_password) {
    artifactory_request('/api/security/apiKey', sso_password, "get").then((response)=>{
        // first get current key
        if (response && response.status == 200){
            if (response.data.hasOwnProperty("apiKey")) {
                // key already exist
                let refresh_token = $("#api-token-checkbox").prop('checked');
                if (refresh_token) {
                    var req_type = "put";
                } else {
                    // just get it
                    var req_type = "get";
                }
            } else {
                // key does not exist, generate key
                var req_type = "post";
            }
            
            artifactory_request('/api/security/apiKey', sso_password, req_type).then((response)=>{
                if (response && response.status == 200){
                    $("#password").val(response.data["apiKey"]);
                    $("#password").trigger("change");
                } 
            })
        } else {
            console.log("Cannot get keys");
        }
    })
}


function get_builds(artifacts_list){
    /**
     * Parses information from artifactory server. If see EBU or Workbench build extract version and add to the list
     */
    let version_list = [];
    let version;
    let repo;
    for (let i in artifacts_list) {
        repo = artifacts_list[i]["key"];
        if (repo.includes("EBU_Certified")) {
            version = repo.split("_")[0] + "_ElectronicsDesktop";
            if (!version_list.includes(version)) {
                version_list.push(version);
            }
        } else if (
            repo.includes("Certified") &&
            !repo.includes("Licensing") &&
            !repo.includes("TEST") &&
            !repo.includes("Temp")
        ) {
            version = repo.split("_")[0] + "_Workbench";
            if (!version_list.includes(version)) {
                version_list.push(version);
            }
        } else if (
            repo.includes("Certified") &&
            repo.includes("Licensing") &&
            !repo.includes("TEST") &&
            !repo.includes("Temp")
        ) {
            version = repo.split("_")[0] + "_LicenseManager";
            if (!version_list.includes(version)) {
                version_list.push(version);
            }
        }
    }

    fill_versions(version_list);
    update_ipc_products(version_list);
}

function update_ipc_products(version_list) { 
    // send newly received versions to main process
    products_dict.versions =  version_list;
    products_dict.last_refreshed = seconds_since_epoch();
    ipcRenderer.send('set-products', products_dict);
}

function fill_versions(version_list){
    /**
     * Fills drop down menu with AEDT and WB versions
     */
    
    if (!version_list) {
        return;
    }

    version_list.sort(function (a, b) {
        if (a.slice(1, 6) > b.slice(1, 6)) {return -1;}
        else if (b.slice(1, 6) > a.slice(1, 6)) {return 1;}
        return 0;
    });

    if (version_list.includes(settings.version)) {
        set_selector("version", version_list, settings.version);
    } else {
        set_selector("version", version_list);
        save_settings.call($("#version")[0]);
    }
}


function open_artifactory_site(){
    /**
     * When double click on artifactory dropdown menu
     */
    let url = artifactory_dict[$("#artifactory").val()]
    shell.openExternal(url);
}


function clean_products_list() {
    /** 
     * Clean versions array in browser windows and main win, otherwise it will be filled
     */
    
    if (products_dict) {
        products_dict.versions = [];  
        ipcRenderer.send('set-products', products_dict.versions);
    }
}


function change_password() {
    /**
     * Password is stored in settings in another dictionary (Object), extract it for selected artifactory
     */

    let visible;
    let password;
    if ($("#artifactory").val() === "SharePoint") {
        visible = 'hidden';
    } else {
        visible = 'visible';
        password = (settings.password.hasOwnProperty(settings.artifactory)) ? settings.password[settings.artifactory] : "";
        $("#password").val(password);
    }

    $("#password").css('visibility', visible);
    $('label[for="password"]').css('visibility', visible);

    $("#get-token-button").css('visibility', visible);

    $("#username").css('visibility', visible);
    $('label[for="username"]').css('visibility', visible);
}

$('.clockpicker').clockpicker({
    /**
     * enable JQuery clockpicker for time selection for scheduling
     */
    autoclose: true,
    placement: 'left'
});

$("#artifactory, #username, #password, #time, #version, .days-checkbox").bind("change", save_settings);
$("#artifactory").bind("change", change_password);
$("#artifactory").contextmenu(open_artifactory_site);
$("#artifactory, #username, #password").bind("change", request_builds);

$("#schedule-button").click(function (){
    /**
     * Execute when click on schedule button. Verify that at least one day is selected
     * If version is empty or not equal to drop menu => server is not grabbed yet => return
     * 
     * Make copy of settings file to another file for scheduling
     * If all checks are fine then set a task and retrieve a new tasks list
     */
    if(settings.days.length === 0){
        alert("At least one day should be selected!");
        return;
    }

    if(settings.version === $("#version")[0].value && settings.version){
        var scheduled_settings = path.join(app_folder, settings.version + ".json");
        fs.copyFileSync(settings_path, scheduled_settings, (err) => {
            if (err) throw err;
        });
        schedule_task(scheduled_settings);

        setTimeout(() => {
            get_active_tasks();
        }, 1000);
        
    } else {
        alert("Version does not exist on artifactory");
    }
})

$("#install-once-button").click(function (){
    /**
     * Execute when click on install once button.
     * If version is empty or not equal to drop menu => server is not grabbed yet => return
     * 
     * Make copy of settings file to another file for installing once
     */
    if (settings.version === $("#version")[0].value && settings.version) {
        const install_once_settings = path.join(app_folder, "once_" + settings.version + ".json");
        fs.copyFileSync(settings_path, install_once_settings, (err) => {
            if (err) throw err;
        });
        install_once(install_once_settings);
        let answer = dialog.showMessageBoxSync(remote.getCurrentWindow(), {
                type: "question",
                buttons: ["Yes", "No"],
                message: "Installation started! Do you want to open progress monitor on Installation History page?"
            }
        )

        if (answer === 0) {
            setTimeout(() => {
                // some issue with SharePoint. Better to put some timeout
                location.href = 'file://' + __dirname + '/history.html', "_self";
            }, 1700);
        }
    } else {
        alert("Version does not exist on artifactory");
    }
})


const sso_window = document.getElementById('sso-password-window');


$("#get-token-button").click(function(){
    /**
     * Show get API key dialog
     */

    sso_window.classList.remove('hidden');
    return false;
});

function closeGetApiWindow() {
    $("#sso-password").val("");
    sso_window.classList.add('hidden');
}

function getApiKey() {
    /**
     * Send request to artifactory to get or refresh API token
     */

    let sso_password = $("#sso-password").val();
    $("#password").val("");
    $("#version").empty();
    $("#version").append($('<option>', {value:1, text:"Requesting API key..."}))

    send_get_api_request(sso_password);

    const looper = setInterval(function () {
        // need to repeat get key, otherwise does not work from the first time
        if (!$("#password").val()) {
            send_get_api_request(sso_password);
        }
        clearInterval(looper);
    }, 7000);

    $("#sso-password").val("");
    sso_window.classList.add('hidden');
}