<?php

use GlpiPlugin\Painelbot\Config;
use GlpiPlugin\Painelbot\Direito;

Session::checkRight(Direito::CONFIG, READ);

if (isset($_POST['salvar'])) {
    // CSRF já validado pelo core (POST); salvar() exige "Parâmetros e conexão" > Editar
    Config::salvar($_POST);
}

Html::redirect('/front/config.form.php?forcetab=' . urlencode(Config::class . '$1'));
