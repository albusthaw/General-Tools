package io.github.albusthaw.clinicalscribe;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.util.regex.Pattern;

/**
 * The only links that may open the app. Everything else is ignored before the
 * page sees it. The same rules are checked again in the page (lib/platform/links.js).
 *
 *   io.github.albusthaw.clinicalscribe://connect?server=https://...   fills in the server link
 *   io.github.albusthaw.clinicalscribe://auth?code=...                finishes a Google sign-in
 */
final class LinkRules {

    static final String SCHEME = "io.github.albusthaw.clinicalscribe";
    private static final Pattern CODE = Pattern.compile("[A-Za-z0-9_-]{8,200}");
    private static final int MAX_LENGTH = 2048;

    private LinkRules() {}

    static boolean isAccepted(String link) {
        if (link == null || link.isEmpty() || link.length() > MAX_LENGTH) return false;
        URI uri;
        try {
            uri = new URI(link);
        } catch (URISyntaxException e) {
            return false;
        }
        if (!SCHEME.equals(uri.getScheme()) || uri.getRawUserInfo() != null || uri.getPort() != -1) return false;
        String target = uri.getHost();
        String query = uri.getRawQuery();
        if ("connect".equals(target)) {
            String server = param(query, "server");
            return server != null && server.startsWith("https://") && server.length() <= 500 && !server.matches(".*\\s.*");
        }
        if ("auth".equals(target)) {
            String code = param(query, "code");
            if (code != null) return CODE.matcher(code).matches();
            return param(query, "error") != null || param(query, "error_description") != null;
        }
        return false;
    }

    /** The decoded value of one query parameter, or null. */
    static String param(String rawQuery, String name) {
        if (rawQuery == null) return null;
        for (String pair : rawQuery.split("&")) {
            int equals = pair.indexOf('=');
            String key = equals < 0 ? pair : pair.substring(0, equals);
            if (!key.equals(name)) continue;
            String value = equals < 0 ? "" : pair.substring(equals + 1);
            try {
                return URLDecoder.decode(value, "UTF-8");
            } catch (UnsupportedEncodingException | IllegalArgumentException e) {
                return null;
            }
        }
        return null;
    }
}
