<?php

use GlpiPlugin\Painelixc\Install;

function plugin_painelixc_install(): bool
{
    return Install::install();
}

function plugin_painelixc_uninstall(): bool
{
    return Install::uninstall();
}
