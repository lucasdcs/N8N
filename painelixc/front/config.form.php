<?php

use GlpiPlugin\Painelixc\Config;

Session::checkRight(PLUGIN_PAINELIXC_RIGHT, UPDATE);

if (isset($_POST['salvar'])) {
    // CSRF já validado pelo core (POST)
    Config::salvar($_POST);
}

Html::redirect('/front/config.form.php?forcetab=' . urlencode(Config::class . '$1'));
